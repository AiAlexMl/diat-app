---
paths:
  - "app.js"
  - "ui.js"
  - "index.html"
---

# Architecture

Pure client-side web app (HTML + CSS + vanilla JS), Hebrew RTL. No build step, no modules, no framework.

**Script load order is strict** — `index.html` loads in this exact sequence:
1. `data.js` — `DB` (food database) and `MEAL_TIMES` (meal schedule templates)
2. `app.js` — global state `S`, `calcMacro()`, `buildMenu()` and all builder functions
3. `ui.js` — DOM manipulation, `goTo()`, `renderMenu()`

`ui.js` calls functions and reads variables defined in both `data.js` and `app.js`.

🔑 **`app.js` has zero top-level execution** (verified: every statement is inside a function or a
declaration; `ui.js`, by contrast, runs five — `loadState()`, `applyGender()`, `updateMacroDisplay()`
and the day restore). **This is an invariant worth protecting, not an accident:** it is what lets
another page load `data.js` + `app.js` and call `calcMacro()` / `bmiWarnText()` / `buildBlockText()`
with no side effects and no refactor. ⚠️ **Adding a line that runs at the top level of `app.js`
breaks that silently.**

**Pages beyond `index.html`** (the app itself is only one of them):
- `coaches.html` · `coach-demo.html` · `coach-dashboard.html` · `coach-setup.html` · `coach-terms.html` — the coach funnel; see CLAUDE.md.
- `menu-1500/` · `menu-1800/` · `menu-2000/` — **SEO pages, pure static HTML with no scripts at all.** The menus in them are baked snapshots that do **not** track the engine. See CLAUDE.md → "SEO menu pages".
- `privacy.html` · `terms.html` · `accessibility.html` · `c/<slug>/` redirect pages.

**3 screens** toggled via `display:none` / `display:block` — no routing. Step-bar dots updated via `.done` / `.active` classes.

⚠️ **היו 5 עד 31/08/2026.** מסכי "מה אני אוהב" ו"מה אני לא אוכל" ירדו מהמסלול: הם דרשו לעבור על 114 מאכלים לפני שרואים משהו, ובתצפית על משתמשים אנשים **לא הבינו מה מוצג להם** ולא ידעו מתי סיימו. ⇒ **ברירת המחדל היא לא לגעת ולתת למנוע לבנות**, והבחירה עברה לחלון `#food-picker` שנפתח לפי בחירה בלבד (משורה במסך ההעדפות ומכפתור שקט בתפריט). `goTo` מזהה מסכים **לפי אינדקס**, ולכן מסך התפריט הוא כעת `goTo(2)`.

## Global State `S` (defined in `app.js`)

- **User inputs**: `gender`, `goal`, `age`, `height`, `weight`, `diet` (Set), `allergy` (Set), `time`, `noTrain`
- **User selections**: `liked` (Set of food IDs), `avoided` (Set of food IDs)
- **Computed macros**: `bmr`, `rmr`, `target`, `proteinG`, `fatG`, `carbG`
- **Runtime flags**:
  - `bmiWarning` (string | null) — set by `buildMenu()` when cut+BMI<20 or bulk+BMI≥30
  - `carbWarning` (string | null) — set by `calcMacro()` when target was raised to meet macro floor
  - `menuWarning` (string | null) — set by `reconcile()` when calories can't meet the target even after shrinking protein to the 1.6 g/kg floor (fatty/plant-only protein on a low target)

The meal **count is dynamic**: `mealPlan(key, target)` adds 1–3 snacks for high (bulk) targets, so a day can have 4–7 meals.

## State Persistence (ui.js)

All user inputs/selections persist to `localStorage['dietai-state']` (Sets serialized as arrays): `saveState()` is called from every mutator (toggles, setters, input listeners); `loadState()` runs once at ui.js load (before the first `updateMacroDisplay()`) — restores `S` **and** syncs the DOM (inputs, chips, buttons, time cards, counts). `resetApp()` clears the key. Everything is try/catch-wrapped — blocked localStorage (private mode) degrades to no persistence. This is the future migration path to Supabase `profiles`.

## Day State (ui.js) — `localStorage['shapeat-day']`

The generated menu is a persistent **day**: global `DAY = { date, target, meals(live), eaten[], note, warn{bmi,carb,menu}, gLabel, tLabel, morningTip }`. `serializeDay`/`deserializeDay` flatten items to `{id,g,...}` (food refs reattached from `FOOD_BY_ID = ALL+TREATS`; manual items `{manual:true,name,...}` survive too; salads keep `comps`+`oilG`; meals keep `removed` **and `added`**). On app load, a saved day renders immediately (screen 4, "daily companion" behavior). **A stale date returns to the clean base menu**: `loadDay` drops carried-over treats (`type:'treat'`), rebalance-added meals (**by the `added:true` flag only**, set in `rebalanceDay`), and `removed` meals, then resets `eaten` and `note` — so a new day never inherits yesterday's planned treats or mid-day-added snacks. **Never filter by the `'נשנוש נוסף'` label**: `buildMenu`'s `mealPlan` appends base-menu snacks with that same label (without `added`) for high calorie targets — the old label fallback silently stripped them on rollover, leaving tomorrow's base day ~46% under target (found & fixed 10/07/2026). `S.treats` (app.js) is an array of planned-treat ids, restored from the treat card in `loadDay`. A transient `DAY.noteAction` (not serialized) renders an action button beside `DAY.note` (e.g. "אזן את ההמשך" after per-item removal). Check-marks (`toggleEaten`) update in place + drive the daily progress bar; `rebuildRest` (app.js) mutates `DAY.meals/eaten` for mid-day corrections. `resetApp()`/`clearDay()` remove the key; rebuild actions ask `confirmRebuild()` when marks exist.

## Weight tracking (supabase-client.js — additive layer)

Account-gated progress graph, built **entirely in `supabase-client.js`** (no ui.js/app.js changes beyond CSS) so it layers on like the account/sync code. Local-first cache `localStorage['shapeat-weights']` (`[{date,kg,saved_at}]`) is the display source, mirrored to cloud `weight_logs` through the same debounced push / on-login pull outbox as favorites (`pendingWeightUpserts`/`Deletes`, `dirty.weight`). `localStorage['shapeat-uw-alerted']` tracks the once-per-episode underweight-referral flag. The menu-screen slot is injected after `.summary-card` by **wrapping `window.renderDay`** (covers both build via `renderMenu` and page-load restore, since bare `renderDay()` calls resolve through the global binding) and re-injected on auth change / after each log. Internal surface exposed at `window._shapeatWeight` for the account-modal tab and QA. Reads globals `S.weight/S.height/S.goal`, `DAY.date`, `dateLabel`, `esc`, `showToast`. Full spec: `internal/ROADMAP.md` "מעקב משקל v1"; per-decision detail in CLAUDE.md.

## Key UI Functions (ui.js)

| Function | Description |
|----------|-------------|
| `goTo(n)` | Navigate to screen n (0–2); calls `updateMacroDisplay()` |
| `openFoodPicker(mode)` / `closeFoodPicker()` / `foodPickerTab(mode)` | חלון בחירת המאכלים — שתי לשוניות מעל אותו `renderGrid` |
| `neverAgain(id)` | "אל תציע יותר" מכרטיס הארוחה → `S.avoided` + טוסט ביטול |
| `updateMacroDisplay()` | Reads form inputs → `calcMacro()` → updates RMR box + live BMI warning on screen 0 |
| `renderMenu()` | Calls `buildMenu()`, builds full HTML, navigates to screen 2 (התפריט). **נקרא ישירות מכפתור ההמשך של מסך ההעדפות** |
| `resetApp()` | Clears all Sets, resets goal/time/noTrain, resets all chip/button UI, calls `goTo(0)` |
| `renderGrid(mode)` | Renders category tabs (with badge counts) + food cards for `'like'` or `'avoid'` mode |
| `toggleFood(mode, id)` | Toggles a food in `S.liked`/`S.avoided`, updates card UI + calls `updateTabBadges()` |
| `updateTabBadges(mode)` | Updates badge counts on all category tabs without re-rendering the food grid |
| `closeDisclaimer()` | Hides the disclaimer overlay |
