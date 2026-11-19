(() => {
  const FP = 65536;
  const TURN = 4096;
  const INF = 0x3fffffff;
  const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  let setup, goals, open, fields, home, middle, away, plan;
  let routeCache, movementHistory;

  const angle = (dx, dy) => Math.round(Math.atan2(dy, dx) * TURN / (2 * Math.PI)) & (TURN - 1);
  const turnBy = (from, to) => ((to - from + TURN / 2) & (TURN - 1)) - TURN / 2;
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const tile = (x, y) => (x >> 16) + (y >> 16) * setup.map.width;

  function makeField(goal) {
    const { width, height, heights, terrain } = setup.map;
    const dist = new Int32Array(width * height).fill(INF);
    const queue = Array.from({ length: 64 }, () => []);
    const gx = goal.x >> 16;
    const gy = goal.y >> 16;
    let queued = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const pos = y * width + x;
        if (!open[pos]) continue;
        dist[pos] = 0;
        queue[0].push(pos);
        queued++;
      }
    }
    for (let cost = 0; queued; cost++) {
      const bucket = queue[cost & 63];
      while (bucket.length) {
        const at = bucket.pop();
        queued--;
        if (dist[at] !== cost) continue;
        const x = at % width;
        const y = (at / width) | 0;
        for (let k = 0; k < NEIGHBORS.length; k++) {
          const [dx, dy] = NEIGHBORS[k];
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!open[next] || (dx && dy && (!open[at + dx] || !open[at + dy * width]))) continue;
          const speed = setup.rules.terrainSpeed[terrain[at]] || FP;
          const step = Math.round((k < 4 ? 9 : 13) * FP / speed) + Math.min(12, Math.max(0, heights[at] - heights[next]));
          const total = cost + step;
          if (total >= dist[next]) continue;
          dist[next] = total;
          queue[total & 63].push(next);
          queued++;
        }
      }
    }
    return dist;
  }

  function choosePlan(observation, living) {
    const points = observation.objectives;
    const lead = observation.score[setup.side] - observation.score[1 - setup.side];
    const homeThreat = observation.contacts.filter((enemy) => distance(enemy, goals[home]) < 15 * FP).length;
    const homeHeld = points[home].owner === setup.side;
    const homeGuard = [...living].sort((a, b) => {
      const aCost = fields[home][tile(a.x, a.y)];
      const bCost = fields[home][tile(b.x, b.y)];
      return (aCost - bCost) || (a.id - b.id);
    })[0];
    const other = middle < 0 ? away : middle;
    const defend = homeThreat > 1 || (points[home].state === "contested" && lead >= 0);
    const holdLead = lead > 140 && homeHeld && middle < 0 && observation.tick > setup.rules.maxTicks / 3;
    const recoverHome = !homeHeld && homeThreat > 0 && living.length < 3;
    plan = new Map();
    for (const unit of living) {
      let goal = unit.id === homeGuard.id ? home : other;
      if (defend || holdLead || recoverHome) goal = home;
      if (living.length === 1 && homeHeld && lead < 0 && homeThreat === 0) goal = other;
      plan.set(unit.id, goal);
    }
  }

  function route(unit, index, tick) {
    const cached = routeCache.get(unit.id);
    if (cached && cached.goal === index && tick - cached.tick < 5 && !unit.blocked) return cached;
    const { width, height } = setup.map;
    const field = fields[index];
    let current = tile(unit.x, unit.y);
    let x = current % width;
    let y = (current / width) | 0;
    let waypoint = null;
    for (let step = 0; step < 3; step++) {
      let best = current;
      let cost = field[current];
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (field[next] >= cost || (dx && dy && (!open[current + dx] || !open[current + dy * width]))) continue;
        best = next;
        cost = field[next];
      }
      if (best === current) break;
      current = best;
      x = current % width;
      y = (current / width) | 0;
      const wx = x * FP + FP / 2;
      const wy = y * FP + FP / 2;
      if (step > 0 && !open[tile((unit.x + wx) / 2, (unit.y + wy) / 2)]) break;
      waypoint = { x: wx, y: wy };
    }
    const next = { ...(waypoint || goals[index]), goal: index, tick };
    routeCache.set(unit.id, next);
    return next;
  }

  function visiblePath(unit, x, y) {
    const { heights, terrain } = setup.map;
    const eye = setup.rules.units[unit.kind].eyeHeight;
    const fromHeight = heights[tile(unit.x, unit.y)] + eye;
    const toHeight = heights[tile(x, y)] + 3;
    const dx = x - unit.x;
    const dy = y - unit.y;
    const segments = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / FP));
    let forests = 0;
    let previous = -1;
    for (let step = 1; step < segments; step++) {
      const weight = step / segments;
      const index = tile(unit.x + dx * weight, unit.y + dy * weight);
      if (index === previous) continue;
      previous = index;
      if (terrain[index] === 4 || terrain[index] === 6 || heights[index] > fromHeight + (toHeight - fromHeight) * weight) return false;
      if (terrain[index] === 1 && ++forests >= setup.rules.forestStopsShellsAfter) return false;
    }
    return true;
  }

  function attack(unit, order, seen) {
    const spec = setup.rules.units[unit.kind];
    const gun = spec.gun;
    if (!gun.shellSpeed) return;
    let best = null;
    let bestScore = Infinity;
    const maxX = setup.map.width * FP - 1;
    const maxY = setup.map.height * FP - 1;
    for (const enemy of seen) {
      const travel = distance(unit, enemy);
      if (travel > gun.maxRange + 3 * FP) continue;
      const radians = enemy.heading * 2 * Math.PI / TURN;
      const vx = Math.cos(radians) * enemy.speed;
      const vy = Math.sin(radians) * enemy.speed;
      const first = Math.max(0, (travel - spec.radius) / gun.shellSpeed);
      const duration = Math.min(14, Math.max(0, (Math.hypot(enemy.x + vx * first - unit.x, enemy.y + vy * first - unit.y) - spec.radius) / gun.shellSpeed));
      const x = clamp(Math.round(enemy.x + vx * duration), 0, maxX);
      const y = clamp(Math.round(enemy.y + vy * duration), 0, maxY);
      const target = angle(x - unit.x, y - unit.y);
      const lineOpen = unit.reload <= 1 && visiblePath(unit, x, y);
      const score = travel / FP + Math.abs(turnBy(unit.turret, target)) / 180 + enemy.hpFrac / FP * 5 - (enemy.kind === "mbt" ? 2 : 0) - (lineOpen ? 18 : 0);
      if (score >= bestScore) continue;
      best = { x, y, target, travel, lineOpen };
      bestScore = score;
    }
    if (!best) return;
    order.aimAt = [best.x, best.y];
    if (unit.reload <= 1 && best.travel < gun.maxRange - FP / 2 && best.lineOpen) {
      const steerAngle = order.steer ? Math.trunc(order.steer * spec.turnRate / FP) : 0;
      const postHeading = (unit.heading + steerAngle) * Math.PI * 2 / TURN;
      const endX = unit.x + Math.round(Math.cos(postHeading) * unit.speed);
      const endY = unit.y + Math.round(Math.sin(postHeading) * unit.speed);
      const slew = clamp(turnBy(unit.turret, best.target), -spec.turretRate, spec.turretRate);
      const nextAim = angle(best.x - endX, best.y - endY);
      if (Math.abs(turnBy(unit.turret + slew, nextAim)) <= Math.max(2, gun.aimTolerance - 2)) order.fire = order.aimAt;
    }
  }

  function steer(unit, order, destination, holding, observation) {
    const spec = setup.rules.units[unit.kind];
    let heading = angle(destination.x - unit.x, destination.y - unit.y);
    let speed = holding ? 0 : FP;
    let enemy = null;
    let enemyDist = 34 * FP;
    for (const candidate of observation.contacts) {
      const range = distance(unit, candidate);
      if (range >= enemyDist) continue;
      enemy = candidate;
      enemyDist = range;
    }
    if (holding) {
      const target = enemy || goals[away];
      heading = angle(target.x - unit.x, target.y - unit.y);
    }
    let delta = turnBy(unit.heading, heading);
    if (!holding && Math.abs(delta) > TURN * 0.39 && !enemy) {
      speed *= -0.8;
      delta = turnBy(unit.heading, (heading + TURN / 2) & (TURN - 1));
    }
    const blocked = movementHistory.get(unit.id) || 0;
    movementHistory.set(unit.id, unit.blocked ? blocked + 1 : 0);
    if (!holding && blocked > 11) {
      speed = -FP;
      delta += unit.id % 2 ? 15 : -15;
    }
    order.steer = Math.round(clamp(delta / Math.max(spec.turnRate, 1), -1, 1) * FP);
    order.throttle = Math.round(speed * clamp(1 - Math.abs(delta) / 420, 0.12, 1));
  }

  globalThis.controller = {
    draft() {
      return ["mbt", "mbt", "mbt"];
    },

    hello(h) {
      setup = h;
      goals = h.objectives;
      const spawn = { x: h.map.spawns[h.side][0] * FP, y: h.map.spawns[h.side][1] * FP };
      const rank = goals.map((_, i) => i).sort((a, b) => distance(goals[a], spawn) - distance(goals[b], spawn));
      home = rank[0];
      middle = rank.length === 3 ? rank[1] : -1;
      away = rank[rank.length - 1];
      open = Uint8Array.from(h.map.terrain, (terrain) => h.rules.terrainSpeed[terrain] > 0 ? 1 : 0);
      fields = goals.map(makeField);
      routeCache = new Map();
      movementHistory = new Map();
      plan = new Map();
    },

    tick(o) {
      const living = o.units.filter((unit) => unit.alive);
      if (!living.length || !goals.length) return { units: [] };
      if (!plan.size || o.tick % 20 === 0) choosePlan(o, living);
      const seen = o.contacts;
      return { units: living.map((unit) => {
        const order = { id: unit.id };
        const goal = plan.get(unit.id) ?? home;
        const point = goals[goal];
        const holding = distance(point, unit) + FP * 0.55 < point.radius;
        if (o.canMove) steer(unit, order, holding ? point : route(unit, goal, o.tick), holding, o);
        attack(unit, order, seen);
        return order;
      }) };
    },
  };
})();
