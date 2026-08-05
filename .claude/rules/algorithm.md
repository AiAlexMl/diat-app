---
paths:
  - "app.js"
---

# Macro & Menu Algorithm

## Diet/allergy filter (`allowed`)

Excludes by avoided-set, allergy tags, and diet: vegan/vegetarian/lactose; **`gluten_free` excludes `gluten`-tagged foods**; `gfOnly` items appear only for GF users; `supplement`/`vegOnly`/`containsMilk`/`optIn` gating as documented in `data-schema.md`.

## Macro Calculation (`calcMacro`)

- **BMR**: Harris-Benedict 1919
- **RMR** = BMR × 1.2
- **Calorie target**:
  - cut: RMR − `min(500, rmr×0.20)` (dynamic deficit, max 20% of RMR)
  - maintain: RMR
  - bulk: RMR + 300
  - Floor: `Math.max(target, female ? 1200 : 1500)`
- **Protein**: `weight × 2g` (**vegans: × 1.6g** — hard to reach 2 from plants); if BMI ≥ 30, uses lean-body proxy (`25 × height_m²`) instead
- **Fat target**: `max(25g men / 40g women, 25% of target ÷ 9)` — 25% of calories (raised from 20% on 12/07/2026 per a coach's expert feedback: 20% is the low end, WHO caps at ≤30%; 25% improves satiety without starving carbs). Gram floors unchanged. Measured (2016-build matrix): fat lands at 25.0% median, calorie accuracy *improved* (overall dev −1.5%→−0.8%), protein unchanged, fiber <14g/1000 nudged 2.4%→3.0% (fewer carbs ⇒ slightly less fiber; still well under the pre-fiber-work 7.3%). Carbs stay abundant by goal: cut ~43% / maintain ~52% / bulk ~57%. **Bonus:** less carb budget ⇒ **fewer inflated carb piles** — hot meals with ≥300g carbs dropped 57%→40.5% and carb-pile splits per menu 0.52→0.32 (the split mechanism below fires less because the underlying pile shrank).
- **Carb floor**: if `protein×4 + fat×9 + 400 > target`, target is raised to fit — sets `S.carbWarning`
- **Carbs**: `(target − protein×4 − fat×9) / 4`

## State Flags

- `S.bmiWarning` — set by `buildMenu()`: cut+BMI<20 or bulk+BMI≥30
- `S.carbWarning` — set by `calcMacro()`: when target was raised to meet macro floor

## Menu Building (`buildMenu`)

1. Calls `calcMacro()`
2. Sets `S.bmiWarning` (cut+BMI<20 or bulk+BMI≥30)
3. `mealPlan(key, target)` picks the `MEAL_TIMES` schedule (by `S.time`/`S.noTrain`) and **appends extra snacks for high calorie targets** (>2100 → +1, >2400 → +2, >2900 → +3, at 10:30/16:00/21:30/14:30), re-sorted by time and `pct` re-normalised — so a bulk's calories spread over 5–7 meals instead of ballooning single portions. **Single-hot-meal schedules (`noTrain`/`morning`) with target > 2200 get one extra snack** so the lone hot meal doesn't carry ~50 % of the day (acute on restrictive diets where the other meals can't fill).
4. **Budget-aware order**: builds the **non-hot** meals first (mostly unit portions), then the **hot** meal(s) last with `budget = target − Σ(other meals' cal)` (split by `pct` if two hot meals) — so the gram-weighted meat+carb fill the gap from the start. Display order is the original schedule order.
5. Each meal is built via `buildMealBest(type, budget, used, ctx)` — runs `buildMeal` 5× (random templates), each on a **cloned** `used` Map, and keeps the best by score = calorie-fit **+ a lean-fat preference** (penalises fat above the meal's expected share `S.fatG·budget/target`) **+ a fiber preference** (weight 0.7 penalty below the meal's expected fiber share `S.fibG·budget/target` = the floor; weight 0.5 penalty above **2.5×** that share = a far-band ceiling that reins in vegan legume piles without touching normal menus). This "swap a meal that fits better" both hits the budget and steers toward lean foods (chicken breast over thigh, 0% yogurt, white over yellow cheese) so fat stays near target **from the source** — the biggest fat lever, since most fat comes from fixed-portion protein foods. Fiber uses the same from-the-source principle: **no reconcile stage** (fiber rides on food *choice*, not grams — a Stage 4 would fight Stages 1–3). Shares the `used` Map and `ctx.usedCarbCats`.
   **Fiber target**: `S.fibG = round(target × 14/1000)` in `calcMacro` (IOM: 14 g/1000 kcal). **Measured (07/2026, 2016-build matrix)**: builds <14 g/1000 kcal dropped 7.3% → **2.4%** (excluding the structurally carb-poor gluten-free segment: ~1.1%; GF stays ~10% — no whole breads/oats); vegan daily fiber (structural excess — plant-protein targets force legume mass) 75.8 → **66.3 g** median vs a 25–38 g recommendation — residual excess accepted & now visible in the UI; a user-facing warning banner was deliberately deferred. Calorie/protein/fat accuracy unchanged (calorie medians ≤±2.8% in every segment, vegan protein 1.5 g/kg, fat p90 ×1.1). Related: `isProt` (Stage 1) counts a legume as a protein lever **only if `p ≥ 7`** (consistent with `convertDemeatedMeal`) — peas (p 5.4) was being inflated to 350 g for protein, dragging fiber; it can still appear at template-picked size (~300 g vegan mains — residual).
6. After all meals: if no fruit was used and `target > 1200`, injects one fruit into the snack
7. **`reconcile(meals)`** (runs last) — adjusts the menu so the daily macros land near target

## Macro reconciliation (`reconcile`) — 3 stages

The build is bottom-up (per-item rounding, clamps, skipped `optional` slots), so raw totals drift. `reconcile(meals)` runs an outer loop (≤6) of three stages so protein & fat land near target and carbs absorb the rest of the calories.

**Main-protein realism floor + concentration (pre-loop, before Stage 1).** A cooked **meat/fish main** (slot with `protPct`, tagged `_mainProt` + `_minG` in `buildFromTemplate`) must be a realistic portion — `mainProtFloor()` goal-aware **cut 70 / maintain 85 / bulk 90 g** (prevents the old ~30 g meat for a low-weight bulker). Pre-loop pass: the meat main kept (raised to its floor) is chosen by **workout-adjacency first** (a meal tagged `pre`/`post`), then by grams — so when concentrating, the surviving meat sits on the training meal, not an untagged lunch (matters for the evening schedule, which has both an untagged 12:30 hot meal and a `pre` 17:30 one; nutrient timing is secondary to total protein per ISSN, but if we keep only one meat meal it should be the workout one). An **additional** meat meal that would push total protein **> `S.proteinG×1.15`** has its meat **removed** — i.e., a low-protein-budget day concentrates to **one** meat meal instead of inflating protein. To avoid a bare carb+salad meal, the de-meated meal is rebuilt by **`convertDemeatedMeal`** (omnivores only — vegans/vegetarians never concentrate): it keeps the existing carb (the day's flexible calorie lever) and **adds a light protein anchor by weighted lottery** — egg (w3) / cottage-yogurt (w2) / legume (w1, high-protein only `p≥7` so no peas, given a `_minG≈120 g` floor so Stage 1 can't shrink it to a token portion). When the anchor is a legume the meal's carb is **capped per-item** (`_maxG`: grain ≤250 g / unit-starch ≤2 units) so a legume meal is "legume + one moderate carb + veg" — never a 3-carb pile; the overflow calories flow to the meat meal. `clampG` respects `it._minG` so Stages 1/post-loop never shrink a floored main below it. Carbs (Stage 3) absorb the calorie shift. **Carb-pile split (post-loop):** in any hot meal **without a legume** the single heaviest flexible carb >~350 kcal (grain *or* unit-starch) is split 1:1 into two components of **different** types (grain→adds sweet-potato/potato; starch→adds grain), so no plate is a lone 450 g rice or 3-sweet-potato pile (≤2 carb items/meal). `_maxG` is honored by `reUnit` and Stage 3's `maxOf`/grain-cap. Verified (450-build fuzz): 0 meat <60 g, protein/kg ≤~2.5 even at the extreme (48 kg bulk), normal weight unaffected. Vegan/vegetarian legume mains are not floored. Tolerances: `PROT_TOL=0.07`, `FAT_TOL=0.08`, `CAL_TOL=0.04`. Per-item caps: generic protein ≤350 g (`clampG`), **meat/fish mains ≤ `mainProtCap()` — cut 250 / maintain 280 / bulk 320 g** (a real plate, not the old 350; enforced in `clampG`, the pre-loop mains pass, and `adjustFat`'s lean-swap — the protein remainder flows to Stage 1b's top-up injection), grams-elastic grain via **`grainCap(f)`** — goal-aware so big portions are realistic. Schedule-aware: **single-hot-meal days** (`singleHotMeal()` = `noTrain` or not noon/evening) use higher caps **cut 320 / maintain 480 / bulk 600 g** (the lone hot meal is the calorie sink; the carb-split keeps the plate realistic), while **multi-hot (noon/evening)** keep cut 280 / maintain 350 / bulk 450 g — unchanged. Oats (`breakfast` tag, ids 41/106) tighter at cut 280 / maintain 300 / bulk 350 (a breakfast isn't the day's calorie sink).

**Undershoot handling (top-up, ALL schedules — upgraded 06/07/2026):** Stage 3's proportional-by-calorie distribution under-fills when most levers are capped unit-foods, so a **post-loop top-up** runs in three tiers, each only while still > `CAL_TOL` under target: **(a)** grow existing elastic grains to `grainCap`; **(b)** grow count-levers unit-by-unit (bread→2, crackers→gram-cap, unit-starch→3, or **→2 when the meal has another carb item** — keeps plates un-piled); **(c)** **inject an elastic grain** into a hot meal that has none (happens when a liked legume took the side slot) — beside a legume capped at 250 g and only if the meal has 0 other carbs, else ≤2 carb items. Related guards: the hot meal's `hot_side`/`hot_carb` prefers an elastic grain on single-hot days; **a legume side is taken at most once per day** (`LEGUME_SIDE_IDS` check on `used` — legumes are Stage-1 protein levers, not carb levers; a day whose every hot side was a legume measured −33 %); the carb-pile split **skips meals already holding ≥2 carb items**. `crackerMaxN(unitW)` is now **gram-based** (cut/maintain ~36 g, bulk ~54 g, 2–12 pieces) — thin 4 g cakes previously counted like 9 g ones and starved bread slots. Net (4k-profile matrix): restrictive single-hot medians −8.3 % → ≤ −4.1 %, p10 −20…−26 % → −10…−13 %; multi-hot restrictive p10 −24 % → −4 %.

- **Stage 1 — protein → ±7% of `S.proteinG`.** Lever = grams-elastic protein items (`isProt`: meat/fish/legume with no `unitLabel`, not `dip`) **and eggs**. Distributes the protein delta by current-protein share; meats/legumes via `reG`+`clampG`, eggs via `adjustEgg(it, targetG)` (nearest size 15/16/17 = 53/63/73 g × count 1–2). Dairy proteins (cottage/yogurt/cheese) are fixed, so the meat/egg absorbs the delta.
- **Stage 1b — protein top-up injection (once).** When protein is still > 7 % short after Stage 1 (meat at `mainProtCap`, or few sources: vegetarian / kosher+lactose-free), inject **one lean protein portion** — candidates sorted liked-first then protein-per-calorie (cottage/yogurt/tuna-if-unused/egg-if-unused/high-p legume/tofu/supplement) — into the lowest-protein non-hot meal that passes `kosherOk`; sized to the deficit via `pick([f]…)`. Stages 2–3 of the same loop absorb the calories. Lifted vegetarian medians 1.32 → 1.57–1.67 g/kg.
  - 🐞 **OPEN DEFECT (found 06/08/2026) — the injection bypasses the realism engine.** The only filters on the target meal are `!removed`, `type !== 'treat'`, `type !== 'hot'` and `kosherOk`. **Nothing checks that the food suits the meal type**, so a breakfast is a prime target (porridge is always the lowest-protein meal) and tuna wins the sort (best protein-per-calorie). Observed in the wild: **`porridge` = oats-in-milk 300 g + honey + pear + canned tuna 53 g.** High-protein legumes have the same exposure (lentils beside porridge). The `MEAL_TEMPLATES` themselves are correct — `porridge` holds only oats + sweet topping + fruit; the injection is pushed in *after* the template and never asks whether it belongs.
  - **Fix direction:** gate the (food × meal) pair on meal-type coherence, not just kosher/diet. Breakfast should accept cheese / yogurt / egg / supplement and reject fish and probably legumes; lunch / dinner / snack keep the full pool. Prefer choosing the best *pair* over the current "best food × lowest-protein meal".
  - ⚠️ **The 8k suite did not catch this**: its coherence invariants cover kosher, diet/allergy, truthful labels, caps, carb-count, condiment/drink roles, salad base, tuna caps and variant groups — **but not "an injected protein must fit the meal type"**. Add that invariant with the fix, otherwise the regression is invisible.
- **Stage 2 — fat → ±8% of `S.fatG`**, via `adjustFat(meals)`. **Raise:** salad oil (`_oilG` 0–15 g) → scale **present nuts** (`reNuts`, 10–40 g) → if no nuts exist, **inject a small nut portion (10–35 g) into the snack**. **Lower:** protein-preserving lean-ify swaps `LEANER = {9→10, 20→21, 24→23}` (tuna-in-oil→water, cottage 5%→3%, yogurt 5%→0%) → shrink oil → present nuts → if still over, **swap the fattest meat/fish for the leanest allowed same-tag protein** (`reG` to keep protein grams). **Liked foods are never swapped/lean-ified** — preferences win, so a liked schnitzel/salmon stays even if fat then runs high. The main fat control, though, is the lean-fat preference in `buildMealBest` (above) — it also keeps fatty items like schnitzel (id 3, `gluten`) out of default menus unless the user likes them. Hard case: liked fatty proteins + no oil to remove → fat stays high (accepted).
- **Stage 3 — calories → ±4% of `S.target`, carbs only.** Distributes the calorie delta across carb levers **only** — grams-elastic `hot_carb`/`grain` (no `unitLabel`, capped by goal-aware `grainCap(f)`, see above) **plus count-levers**: sliced bread (`reBread`, 1–4), rice/corn cakes (`reCracker`, 2–6), and **unit starches** (`reUnit`, 1–3 units of sweet potato/potato/corn — was the main undershoot source when a starch was the day's hot carb). It **never grows protein to fill calories** — protein is owned by Stage 1 (which raises it to target when low) — so protein can't overshoot. If carbs are exhausted, the menu **accepts a small calorie undershoot** rather than inflate protein. The loop early-exits only when calories **and** protein **and** fat are all in band. (To keep carb capacity, the hot meal's `hot_side` is a legume only when the user likes one — otherwise an elastic grain, so there's always something to grow.)

**Post-loop infeasibility resolve** (runs once after the loop, so no oscillation with Stage 1): if calories still **overshoot** (`dCal > target·(1+CAL_TOL)`) — e.g. liked fatty foods or bulky plant protein on a low (cut) target — shrink the grams-elastic protein items (incl. liked, *portion only, never swapped*) proportionally, clamped so daily protein stays ≥ **1.6 g/kg** (`S.proteinG×0.8`; for vegans the target is already 1.6 so no room). If it *still* overshoots, set **`S.menuWarning`** (shown as a banner) telling the user the preferences/target can't be met precisely.

**Post-loop fat trim** (right after, before the undershoot top-up so freed calories become carbs): when daily fat still exceeds **1.3× `S.fatG`** even though calories are on target — the case where the user marked several fat-dense foods as liked, which Stage 2 never lean-swaps — **trim the grams** of the fattest meat/fish items (liked included, *portion only, never swapped*), fattest first, until fat ≤ ~1.15×. Each trim is clamped so it never drops below the item's `_minG`/`mainProtFloor` **and** never pushes daily protein under the 1.6 g/kg floor. The freed calories are refilled with carbs by the top-up. Effect (40-seed avg): **maintain + fatty likes 1.46× → 1.21×** (protein headroom exists); **cut + fatty likes 2.01× → 1.88×** only (protein already on the floor → no room to trim without swapping, so the honest `S.menuWarning` for fat > 1.5× carries it). Lean/no likes unaffected (control stays ×1.00).

Helpers: **`setMacros(it, f, g)`** is the single source of truth for an item's `cal/p/c/fat/fib` (food values are per-100g) — reused by `mkItem` and every lever. `reG`/`reBread`/`reCracker`/`reUnit`/`reNuts`/`adjustEgg` set `g`+`dispG` then call it; `recalcSalad(sg)` rebuilds a salad group from `_comps`/`_oilG`; `recalcMeal(m)` re-sums meal totals. **Truthful unit labels**: any food with `plural`+`unitG` is snapped to whole units by `mkItem` and labeled "N {plural}" ("3 תמרים", "2 בננות בינוניות") — the label always matches `g`. Other natural-portion items are never rescaled. `buildSalad` returns via `recalcSalad` and keeps `_comps`/`_oil`/`_oilG` so the oil stays tunable.

**Measured accuracy** (06/07/2026, 8k-profile matrix: diets × goals × schedules × like-modes, deterministic seeds; 0 crashes/NaN, **0 coherence-invariant violations** — the suite checks kosher, diet/allergy, truthful unit labels, bread/fruit/cracker/cheese caps, ≤2 carb items per hot plate, condiment/drink roles, salad base, tuna caps, variant groups): every segment's **median within ±4.1%**; regular/multi-hot p10 ≥ −5%. **Residual tails**: gluten-free/restrictive single-hot p10 ~−10…−13% (structurally carb-poor: no gluten breads/oats, crackers gram-capped) — now surfaced honestly by a **generic >8% `S.menuWarning`** set in `buildMenu` after reconcile (under- and over-shoot variants). **Inherent limits**: vegan ~1.5 g/kg protein (target 1.6); vegan/vegetarian **cut** can overshoot (median +10% vegan-cut-multiHot, up to +46% for tiny targets) because the 1.6 g/kg protein floor is untouchable — always warned; fat can't drop if every liked protein is fatty. Yellow cheese capped at 4 slices/meal (`maxMeal:60` in data.js); `pick()` re-snaps to whole units after clamping so unit labels never lie (watermelon 250 g "slice" bug).

## Planned treats (`S.treats`)

`S.treats` is an **array** of `TREATS` ids (data.js, ids 200+) — multiple allowed (e.g. coffee + chocolate). In `buildMenu`: the treats' **summed** calories/fat/carbs are subtracted from the targets **before** building (protein untouched; floors 800 kcal / 20g fat / 50g carbs), the menu is built+reconciled against the reduced target, then `S.target` is restored and one standalone `type:'treat'` card holding **all** treat items is appended (never touched by reconcile). Over-target / >25% warnings use the **sum**. **Zero-cal treats** (Coke Zero, `cal:0`): no budget is reduced, warnings stay silent, the note becomes "🥤 על חשבון הבית — בלי השפעה" (`treatBuildNote`), and the workout-window treat-tip is suppressed when the treat card total `cal === 0`. UI: picker overlay (`openTreatPicker`); `chooseTreat` **pushes** to `S.treats` (mid-day add appends to the existing card + `rebalanceDay`; pre-eaten = full rebuild). `removeTreatItem(idx)` drops one treat (frees budget → `rebalanceDay`); `removeTreat` clears all. `S.treats` is restored from the treat card on day reload (`loadDay`). Rebuilding wipes day check-marks behind a confirm.

## Per-item removal (`removeItem` / `balanceAfterRemoval`)

Each meal card has a ✏️ **edit toggle** (`toggleMealEdit`, pure CSS `.editing` class; hidden on `type:'treat'` and ✓-eaten meals) that reveals an ✕ on every item row. ✕ = `removeItem(mi, ii)` — **"just skip"**: splices the item, `recalcMeal`, drops it from the daily summary/progress, **no rebuild** (other meals untouched); empty meal → `m.removed = true`. A green note explains it and offers an opt-in **"⚖️ אזן את ההמשך"** button via the transient `DAY.noteAction` field (rendered beside `DAY.note`, not persisted). `balanceAfterRemoval(mi)` reuses `rebuildRest` (locks the edited meal as eaten with its **remaining** items — the user ate the rest — and rebuilds only the untouched meals); if the meal was emptied it falls back to plain `rebalanceDay`. Treat rows instead show an always-visible ✕ → `removeTreatItem`.

## Day correction — `rebuildRest(meals, eaten, mealIdx, actualItem)`

"אכלתי משהו אחר": replaces the reported meal's items with what was actually eaten — **one or more items** (UI cart: TREATS / DB search+grams / `manualItem(name, cal)` — conservative macros: p=0, 60/40 carb/fat), locks all eaten meals (+ a not-yet-eaten planned treat), computes remaining targets, and acts by tier (every tier returns a `note` shown as the green day banner — the full-rebuild tier explicitly says the change is **for today only**):
**Workout meals are protected** (`m.tag` = pre/post): never removed in any tier — muscle preservation beats a small calorie overage. In tiers 2/3 they become a light **protein snack** (`proteinSnack`: snack template, falls back to a direct protein pick — cheese/yogurt/egg/meat/fish/legume — if the template came out low-protein); the tier notes mention the kept workout meal.
- **`tR ≤ 0`** (crossed daily target): open meals removed (workout meals → protein snack), positive banner with the overage ("חצית את היעד... מחר דף חדש"; no punishment meals, no compensating deficit — safety by design).
- **`0 < tR < 300`**: keepers = open workout meals (or one light snack if none) + supportive note; the rest removed.
- **`tR ≥ 300`**: full rebuild of open meals with the existing engine — `buildMealBest` per meal + `reconcile` — against temporarily-swapped `S` targets (restored in `finally`). **Two-way meal-count adaptation**: drops trailing **untagged** meals while `tR/openCount < 260` (workout meals never dropped), adds 1–3 extra snacks when `perMeal > 450/600/800` (cap: 6 open meals). The mid-day treat add/remove flows (`chooseTreat`/`removeTreat` in ui.js) reuse `rebalanceDay` without touching eaten meals.

**Measured** (2000 random disrupted days): 0 crashes/NaN; ~15% hit the over/light tiers; of the fully-rebuilt days ~93% land within ±12% of the original daily target (the residual is structural — e.g., the hot meal was the one replaced).

## Meal Templates (the realism mechanism)

Meals are built from **templates** (`MEAL_TEMPLATES` keyed by `breakfast`/`hot`/`snack`/`dinner`), not free category-mixing — so every meal is a coherent plate by construction.

`buildMeal(type)` → `chooseTemplate()` (keep templates whose required slots are fillable for the diet; prefer ones containing a liked food; weighted-random) → `buildFromTemplate()` fills each slot.

A **slot**: `{ match(f,used) | special, calPct, protPct?, max, optional?, spread? }`.
- `special`: `'salad'`→`buildSalad`; `'hotveg'`/`'hotveg_or_salad'`→`buildSingleVeg`/(~40% hot veg else salad); `'hot_carb'`→prefers an unused carb category via `ctx.usedCarbCats`; `'hot_side'`→one starchy side that is a **legume** (only if liked **and no legume side taken yet today** — see top-up section) **or** a `hot_carb` — never both; `'dip'`→optional hummus/tahini side (~25% / if liked), its own row.
- a template may carry `when(used)` (e.g. the `legume` hot template is feasible only when no meat/fish is available — vegetarians/vegans).
- otherwise `pick()` from `ALL.filter(match)`.
- `spread:'ifAlone'` → `makeSpread()` adds a condiment (tahini/PB) to a bread/cracker **only if the meal has no protein yet** (so cottage/egg/tuna meals get no spread). The bread's `displayName` shows "עם X"; the spread is a **separate row** with its own grams/calories.
- **Pita** (39,40, `pita` flag): dropped from bread pools unless the slot has `pitaOk` (only the eggs breakfast bread slot), and even there only ~30% of builds. All other bread slots use the `_sliced` matcher (sliced bread, no pita).
- **Crackers** (45,46,100, `cracker`) stay valid bread substitutes for everyone, but are **one type per menu** via a `VARIANT_GROUPS` entry `[45,46,100]` (no more "rice cakes large + small + corn cakes" in one day — was ~58% of menus, now 0). For this to stay feasible, **`slotFeasible` checks `variantBlocked`** so a template is never chosen when its only filler is variant-blocked, and the `carb_cheese` snack's carb slot uses `_sliced` (bread/cracker, not cracker-only) so it always fills even when the cracker is blocked — this is what keeps vegan snacks (whose fallback was a lone cracker) from going empty. Net: ≤1 cracker per menu, **0 empty meals** across regular/GF/vegan/vegetarian. The per-meal cracker cap is **gram-based** via `crackerMaxN(unitW)` (cut/maintain ~36 g, bulk ~54 g, 2–12 pieces — a thin 4 g cake is not a 9 g one), used in `crackerPortion`, the Stage-3 `maxOf`, and the top-up counters. **Cracker-count normalization (end of `reconcile`)**: an item that lands at **>6 pieces** is swapped to a larger-unit cracker from the same variant group with the same grams ("12 דקות" → "5 גדולות"); a liked cracker is never swapped for an unliked one, and `used` is updated so the one-type-per-menu rule holds.
- **dairy_fruit** snack pairs fruit only with cottage/yogurt; white/yellow cheese go to `carb_cheese` / cheese-bread (always with a carb), never alone with fruit.
- **fruit_nuts** snack / oats nut slot use `nuts` only (almonds/walnuts/cashews) — not avocado/olives (those are salad extras).
- **yogurt_bowl** topping is **granola only** (cooked oats 41 don't belong in a yogurt bowl); topping is optional so yogurt+fruit still works.

Templates: **breakfast** eggs / cheese / yogurt_bowl / porridge / cornflakes / oats_water / bread_spread (vegan-gated: bread+spread+fruit/nuts, `when` no egg/dairy — covers vegan & vegan+GF whose oats are gluten-excluded); **hot** meat (w3) / legume (w1, veg-only) — **always a cooked meat/fish (or legume) main + carb; no canned tuna here**; **snack** dairy_fruit / fruit_nuts / carb_cheese (bread-or-cracker + optional cheese) / shake; **dinner** cheese_bread / tuna_bread / big_salad (canned tuna lives here).

**`big_salad` protein** = egg/cheese (animal). A legume satisfies it **only when the user has no animal protein available** (`!hasAnimalProtein()` — no allowed egg/meat/fish/dairy), i.e. vegans. For omnivores/vegetarians, beans are never "the protein" of a salad meal (they get egg/cheese); vegan dinners stay feasible via legume/tofu.

## Food role flags (enforce realism, set in `data.js`)

- `condiment` (olive oil, tahini, peanut butter) — never standalone; only via `makeSpread` on bread/cracker
- `drink` (milk) — never a protein; only the `milk` slot in cornflakes template
- `complete` (oatmeal-with-milk 106) — self-contained breakfast; its template has no protein slot
- `dip` (hummus-spread 52, tahini 91) — a side dip in hot meals; excluded from legume main/side pools

Legumes for **omnivores**: only a side in a meat meal (`hot_side`) or in `big_salad` — never a standalone hot main. For **vegetarians/vegans** the `legume` hot template is the main (legume + grain + veg), since no meat is available.

## Tuna rule

`tunaUsed(used)` gates all tuna pools: only one tuna type per menu, capped at one can (`maxDay:160`).

## Variant groups (one per menu)

`VARIANT_GROUPS = [[20,21],[15,16,17],[45,46,100]]`, enforced by `variantBlocked(f, used)` inside `pick()` **and in `slotFeasible`**: one cottage type (3%/5%), **one egg dish per menu** (M/L/XL are separate ids, so `used` alone wouldn't block a second omelet), and **one cracker type per menu** (rice-large / rice-small / corn — stops multi-cracker spam). `adjustEgg` additionally **respects a liked egg size** — if the user liked specific size(s), it only resizes within them. Together these also eliminate the old egg-maxDay micro-bug (two meals converging on the same egg id). The `LEANER` swap (20→21) is safe: replaces in place and checks `usedIds`. **`slotFeasible` checks `variantBlocked`** so a template is never selected when its only filler is variant-blocked (would otherwise leave an empty slot/meal).

## Kosher rule

`kosherOk(f, mealTags)` (checked in `buildFromTemplate` on the generic-slot and dip pools): when `kosher` is selected, a meal never mixes `meat` and `dairy` (fish+dairy stays allowed — tuna+cottage is fine). `mealTags` accumulates the tags of items already in the meal. Templates never mix the two anyway — this is an explicit guarantee that survives future templates. The `adjustFat` swaps are same-category (meat→meat, fish→fish, dairy→dairy) so they can't break it.

**6-hour meat→dairy separation** (across meals, not just within one). Halacha requires ~6 h after eating meat before dairy; the reverse (dairy→meat) needs only rinsing, and the schedule gaps (≥4 h) cover it — so only the meat→dairy direction is enforced. A per-meal **`noDairy`** flag is computed in `buildMenu` **after `mealPlan`** (so appended bulk snacks at 10:30/14:30/16:00/21:30 are included): applies only to **kosher + omnivore** (`!vegetarian && !vegan` — vegetarians/vegans have no meat, dairy stays free), where every `type:'hot'` meal is treated as meat (conservative; also covers fish-lunch days at a tiny variety cost). A meal is `noDairy` when its time falls in `(meatTime, meatTime+360min]`. Breakfast is always before lunch ⇒ never `noDairy` ⇒ the morning cottage/yogurt/eggs are preserved. `isDairyKosher(f) = dairy tag || containsMilk` (catches milk-oatmeal 106, whey/casein/protein-bar). Enforcement points, all gated on `ctx.noDairy`/`m.noDairy`: (1) generic pool in `buildFromTemplate` filters out dairy; (2) `slotFeasible`(threaded `ctx`) drops a template whose **required** slot can only be filled by dairy (optional dairy slots like `carb_cheese`'s cheese just come out empty — `if (s.optional) return true` already skips them); (3) `convertDemeatedMeal` omits the cottage/yogurt anchor under kosher (egg/legume only — both parve); (4) Stage 1b protein injection never puts dairy into a `noDairy` meal (picks egg/tuna/legume there, dairy into breakfast/dinner). A subtle `ℹ️` banner (`S.kosherSep` → `DAY.warn.kosherSep`, serialized with the other warnings) explains the separation to the user. **Measured** (8k matrix, kbase HEAD vs knew): **kosherSep violations 887 → 0**, all other coherence invariants stay 0; kosher-segment accuracy essentially unchanged (calorie medians ≤0.3 pp shift, protein/kg identical or ≤0.15 lower and always ≫1.6 floor; `kosher+lactose_free` byte-identical since dairy was already excluded).

## `buildSalad` Rules

- Requires ≥ 2 **regular** (`salad` tag, not `salad_only`) vegetables as base
- Optional 3rd veg from `salad_only` pool (lettuce, cabbage, onion) or a 3rd regular veg
- Olive oil (id:86) always added if permitted — **5g (כפית)**, no daily-use restriction
- Parts display (`fmtPart`): each part shows its `unitLabel` (e.g. "חצי פלפל אדום", "עגבנייה בינונית") — no "name (label)" parentheses; pepper labels include the colour so they stay unambiguous
- Salad extra: optionally adds **avocado (87) or olives (93)** as a savory salad component (when liked or ~30%) — that's their home, never paired with fruit

## Portion Helpers

- `eggDisplay(g, unitW, size)` — rounds to 1–2 eggs by weight, appends size label (M/L/XL)
- `crackerPortion(targetG, unitW)` — snaps to 2–6 pieces using the cracker's own `unitG`
- `cottagePortion(targetG)` — 250g full / 125g half container

## `pick()` Priority

1. Foods in `S.liked` → `allowed()` → not in `used` — **shuffled** (Fisher-Yates)
2. All other allowed foods not yet used — **also shuffled** (for menu variety across regenerations)
3. Serving size: calculated from calorie/protein budget, snapped to `unitG`, clamped to `maxDay`/`maxMeal`

Liked foods always outrank non-liked (liked group comes first); both groups are shuffled internally so menus vary while preferences are still honored. `buildSalad` and `buildSingleVeg` shuffle their non-liked pools the same way.

## `mkItem()` Return Shape

```js
{ f, g, dispG, displayName?, cal, p, c, fat, fib }
```
- `displayName` set only for eggs: "חביתה מביצה אחת (L)"; `dispG` is `''`
- All other items: `displayName` is `undefined`; `dispG` holds the portion string
- `fib` — fiber grams for the served portion (`f.fib || 0`); meals sum it to `totFib`, daily total shown in the summary as "X g / יעד ~Y g" against the `DAY.fibG` snapshot ("~" because DB fiber values are approximate; old saved days without `fibG` fall back to number-only)

**Per-meal realism caps** (`mkItem`): bread ≤2 slices (pita 1); **fruit ≤ ~200 g/meal** (clementine→2, banana/apple→1, small dates stay generous) — so a single meal never shows an unrealistic fruit/bread pile even when the calorie budget would allow it.
