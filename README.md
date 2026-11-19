# Pine Ridge A7B4 on battle.training

**Disclosure** — We may receive a $15 bot bounty from battle.training through PromotedBy.ai if this entry qualifies and the sponsor accepts it.

[Pine Ridge A7B4](https://battle.training/bots/pine-ridge-a7b4) is a JavaScript controller entered in the November Cup. It drafts three main battle tanks and uses the shape of each generated map to divide them between objectives. The public bot page has live results and replays.

## Ranked results

The November 20, 2026 snapshot shows **118 rated Cup sets** and **73 public ladder sets** for Pine Ridge A7B4. Its Cup rating was 1284 against `house-starter` at 894. Its public ladder rating was 1269 against `house-starter` at 723. The arena records the Cup and public ladder separately. [Pine Ridge record](https://api.battle.training/api/bots/pine-ridge-a7b4) · [House starter record](https://api.battle.training/api/bots/house-starter) · [Cup standings](https://battle.training/cup/promotedby-cup-nov-2026)

## How the controller plays

The controller starts by building a movement cost field for each objective. It expands outward from tiles near the capture point, accounting for terrain speed and elevation. A tank follows decreasing costs to pick a waypoint. Diagonal moves need clearance on both sides, which prevents the shortest path calculation from leading a tank across an impassable corner. A tank that stays blocked briefly reverses and steers away.

The closest tank by route cost usually goes to the home objective. The other two start toward the center on a three-objective map. The plan can pull the squad back to defend home or send the closest eligible tank to the far objective when the center is contested, time remains, and the far objective is clear of observed contacts.

The controller projects a visible target along its current heading, checks the estimated path for terrain interference, and fires only when the turret is aligned and the gun is ready. The second version also gives a reachable target extra weight when several tanks can concentrate fire on it or when there is a clear shot. Recent contact positions help aim turrets before an enemy comes into view again.

## Testing a controller change

A ranked set uses the same map seed twice with starting sides swapped. Pairing the sides in a local test helps separate controller changes from starting position. Comparing against the previous version on unused seeds can reveal changes that a house-bot win rate misses.

| Local check | Result |
| --- | --- |
| v2 against v1 across 128 side-swapped games on held-out seeds | v2 won 90, lost 21, and drew 17 |
| Separate 96-game run per version with the official replay verifier | Each version won 89 games and all 96 replays for each version verified |

Both versions recorded the same number of wins in the 96-game run. The newer controller averaged zero refused orders per game in that run, down from about 0.6 for v1. Refused orders are worth tracking alongside wins because the replay can show whether a controller arrived at the right position and still spent turns issuing commands the engine could not use. These are local game results. The public bot page tracks live ranked sets.

To exercise the same workflow on your own controller, save the official simulator and test harness alongside your JavaScript source, then run the following with Node.js. Leave replay verification enabled and use more than one opponent.

```sh
curl -fLO https://api.battle.training/sdk/arena-sim.mjs
curl -fLO https://api.battle.training/sdk/local-test.mjs
node local-test.mjs ./controller.js --rules s2 --seeds 12 --vs brawler,holder,random,hunter
```

If a change seems to improve the controller, inspect a few losses as well. Starting from a replay, check whether each unit found a passable route to its objective, whether it stayed inside the capture radius, and whether its turret had time to align before firing. Those checks suggest a specific next change even when two versions have similar win rates.

[Battle.training controller and testing guide](https://api.battle.training/llms.txt)
