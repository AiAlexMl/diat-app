---
paths:
  - "ui.js"
  - "style.css"
  - "index.html"
---

# UI & Rendering

## Screen Navigation

`goTo(n)` shows screen `n` (0–4), hides others via `display:none`, updates step-bar classes.

| Screen | Content |
|--------|---------|
| 0 | פרטים אישיים — age/height/weight/gender/goal + live RMR box + live BMI warning |
| 1 | העדפות תזונה — diet chips, allergy chips, training time cards |
| 2 | מאכלים מועדפים — category tabs with badge counts, food cards |
| 3 | מאכלים מוחרגים — same grid structure, avoid mode |
| 4 | תפריט — output of `renderMenu()` |

## Live BMI Warning (screen 0)

`updateMacroDisplay()` computes BMI inline and shows/hides `#bmi-warn-box` (`.bmi-warn-inline`):
- cut + BMI < 20 → orange warning
- bulk + BMI ≥ 30 → orange warning
- Otherwise → hidden

## Food Grid (screens 2–3)

`renderGrid(mode)` builds:
1. **Category tabs** — each tab shows a badge with selected-item count for that category
2. **Food cards** — ❤️/🚫 icons, name, prep

`toggleFood(mode, id)` updates the card in-place and calls `updateTabBadges(mode)` to refresh all badge counts without re-rendering the grid.

## Menu Rendering (`renderMenu` → `renderDay` → `dayHtml`)

`renderMenu()` = build path: `buildMenu()` → wraps result in `DAY` (+ warnings/labels snapshot) → `saveDay()` → `renderDay()`. `renderDay()` is a thin shell: `#menu-output.innerHTML = dayHtml(DAY, {})` + `updateDayProgress()` + `updateFavHeart()` + `goTo(4)` — used both after build and on restore-from-localStorage. Removed meals (`m.removed`, set by day-correction) are skipped.

**`dayHtml(day, {readOnly, title})`** is the shared HTML builder. `readOnly: true` (used by the account/history modal in supabase-client.js) drops all interactive chrome: `#day-progress`, treat-bar, noteAction button, `meal-card-N` ids (so `toggleEaten`'s in-place updates never hit the modal copy), edit/remove buttons, `.meal-actions`, bottom actions, `.coach-cta`. `title` overrides the header.

**Menu-screen interactions:** daily progress bar (`#day-progress`, in-place updates); treat bar button (add/remove planned treat). **Two paths, and the gentle one is not the default it looks like:** with any eaten mark or hand-edited meal, `chooseTreat` adds to the treat card and `rebalanceDay` only touches meals that aren't locked. On a **clean** day nothing is locked, so `rebalanceDay` would rebuild everything anyway — hence the clean path goes through `renderMenu()` (better: the budget is reserved *before* the build) behind **`confirmTreatRebuild()`**. That extra confirm exists because `confirmRebuild()` is silent when there are no marks or edits: it guards *work*, and a menu the user has just read and liked is not yet work. Its copy names the way out ("mark what you already ate first"), which moves the user onto the locked path where no confirm appears at all; per-meal `✓ אכלתי` (`toggleEaten` — in-place class+button+progress update) and `🔄 אכלתי משהו אחר` (`openAltPicker` — 3 tabs: TREATS / DB search+grams / manual name+calories → `applyAlt` → `rebuildRest`). `DAY.note` renders as a green `.day-note` banner (day-correction messages).

Renders in order:
1. Menu header (goal label + training label) + **favorites heart** (`#fav-heart` → `toggleFavoriteToday()`; inline SVG, filled `.on` + `aria-pressed` when the displayed build (`buildId`) is saved)
2. `S.bmiWarning` → orange `.bmi-warning` banner (⚠️)
2b. `S.trainWarning` → **red `.field-error` banner (⚠️)** — bulk goal + no training (`trainWarnText()` in `buildMenu`); also shown **live on screen 1** in `#train-warn` via `updateTrainWarn()` (called from `setTime`/`toggleNoTrain`/`setGoal`/`goTo(1)`)
3. `S.carbWarning` → yellow `.bmi-warning` banner (ℹ️)
3b. `S.menuWarning` → yellow `.bmi-warning` banner (ℹ️) — target unreachable with current likes/goal
4. Morning training tip (if applicable)
5. Meal cards
5b. **`DAY.note`** (+ optional `noteAction` button) — sits **between the meals and the summary**, not at the top (12/08/2026). Since editing stopped scrolling the page to the top, a note in the header is invisible without a deliberate scroll; and every note is about the day's numbers, so the summary is where it belongs. `removeItem` also fires a **buttonless toast** carrying the same calories-vs-target figure, which is the one thing the user can't see from where she's standing.
   - 🔑 **Exactly one balance button on screen, always.** `removeItem` calls `checkDayLevel()`, which raises its own warning + "⚖️ אזן לערכים המומלצים", so the screen used to show two stacked cards with two near-identical buttons. Now: **soft case** (under 90% of target) folds the figure into the note and drops the yellow card, keeping `⚖️ אזן את ההמשך` (the better tool — it locks the edited meal and has a ±4% tolerance plus rollback); **below the health floor** keeps the warning as its own prominent card and drops the *note's* button instead, since that message outranks it.
6. Daily summary card (calories/protein/carbs/fat + macro % bars + **fiber row** — "X g / יעד ~Y g" against `DAY.fibG`; snapshot set in `renderMenu`, survives serialize/deserialize; old saved days without `fibG` show the number only)
7. Quiet actions (`.menu-quiet-actions`, two `.pill-btn`): **"↻ תפריט נוסף"** → `confirmRebuild()`+`renderMenu()` and **"📄 שמירה כ-PDF"** → `window.print()` (disabled when a treat exists, with `.print-hint`); then **`.reset-link`** → `resetApp()`. Deliberately demoted — the day is the product, regeneration is secondary.

**Food row name priority:**
1. `it.displayName` if set — eggs: "חביתה מביצה אחת (L)"
2. `it.f.name + it.f.prep` if prep word not already in name (e.g., "ברוקולי מאודה")

**Product image** — each non-salad food row shows a 26px thumbnail (`images/<id>.jpg`, derived from id; `it.f.img` overrides). Hover enlarges it to 150px (`.food-thumb:hover img`) on desktop. On **click/tap** a **lightbox** opens (`openImgLightbox` in ui.js, via a single delegated `document` click listener so it works on both the menu screen and the read-only history modal) — fullscreen `.img-lightbox` overlay (z-index 2500) with the big image + a `✕`; a click **anywhere** / `✕` / `Escape` closes it (fixes the mobile bug where `:hover` enlarged the image with no way to dismiss). `src`/`alt` are set as DOM properties (no HTML injection); `.img-lightbox` is hidden in `@media print` and respects `prefers-reduced-motion`. Missing files hide via `<img onerror>`. Salad parts don't show images yet.

**Salad group** (`isSaladGroup: true`) — renders label + `it.parts.join(' + ')` as subtitle.

**Empty meal** — if `m.items.length === 0`, renders `.empty-meal-note` message instead.

## Regenerate vs. Reset vs. Favorite (menu screen actions)

- **"↻ תפריט נוסף"** (`.pill-btn`) → `renderMenu()` again: rebuilds a fresh menu keeping all of `S` (likes/avoids/diet/goal/time). Variety comes from the shuffles in `pick()`/`buildSalad`. Guarded by `confirmRebuild()` when eaten marks exist.
- **"התחל מחדש (איפוס)"** (`.reset-link`) → `resetApp()`: clears `S.liked`, `S.avoided`, `S.diet`, `S.allergy`; `S.goal`→`'maintain'`, `S.time`→`null`, `S.noTrain`→`false`; resets all chip/toggle/time-card UI, count displays, noTrain button text; clears `localStorage['dietai-state']`; then `goTo(0)`. **Does not touch favorites** (saved snapshots survive reset, by design).
- **Favorites (♥ heart)** — `toggleFavoriteToday()` is a **true toggle** keyed by `buildId`: displayed build saved → `window.removeFavorite` + "הוסר מהמועדפים" toast with a "ביטול" undo action (undo re-saves from the live `DAY`); not saved → `window.saveFavorite()`. `saveFavorite()` itself stays **idempotent save-or-update keyed by `buildId`** (re-hearting the same build updates it in place keeping its `fav_id`; a **different** build on the same date creates a new favorite, so multiple menus per date are kept — the account list distinguishes same-date favorites by save time; the login-intent flow calls it directly, so it must never toggle) and is **silent** — the save toast ("נשמר/עודכן במועדפים ✓" + "צפייה" action) comes only from the supabase-client wrapper. Snapshots in `localStorage['shapeat-favorites']` (cap 30). The heart is an inline SVG button (`aria-pressed`; CSS fills it rose + `heart-pop` animation on `.on`, `prefers-reduced-motion` aware). `loadDay` backfills a missing `buildId` (pre-feature days) and persists it immediately — otherwise the heart could never light. Cloud mirror (table `favorites`) via wrappers in supabase-client.js; `closeAccountModal` re-runs `updateFavHeart()` so in-modal removals reflect on the menu screen.

## Restoring a saved menu (`restoreFavorite`, ui.js — 11/08/2026)

A favorite was read-only: you could look at it but not tick meals or edit it. `restoreFavorite(payload)` makes it **today's live day**, reusing `loadDay`'s midnight transform (reset `eaten`, drop `treat`/`added`/`removed` meals, clear `edited`, new `buildId`, `date = todayStr()`).

- **Favorites only, never day history.** The heart is a statement of intent ("I want this again"); history is a record of what happened, including bad days. A day worth repeating gets hearted.
- **The menu comes back unchanged.** No rebalancing: balancing would rebuild the very thing the user asked to restore, and "↻ תפריט נוסף" already exists for a fresh balanced menu. Hence **no action button** on the banner.
- **`target`/`fibG` are today's; `gLabel`/`tLabel` stay the menu's.** The header describes what the menu *is*; the summary measures it against what's relevant *now*.
- **One dialog, composed of what applies** (marks lost / edits lost / target gap), same pattern as `confirmRebuild` — nothing at stake ⇒ no dialog at all.
- **Quiet `warn.menu` line when the gap is >10%**, no action. Needed because the summary card shows calories with **no** calorie target (only the fibre row shows a ratio), so without it the gap is invisible once the dialog closes.
- **`buildBlockText()` gate runs first** — restore must not be a back door around the BMI hard-stop that blocks building.
- `checkDayLevel()` fires only if the restored menu is below the health floor (possible only for a hand-edited favorite).
- Row helpers `favCalories()` / `favFitsTarget()` (±10% of `S.target`) also drive the favorites list: fitting menus sort first and carry a "מתאים ליעד היום" tag. **Fit is judged on the number, not the goal label** — two cut menus from different weights are different targets.

## Persistence & Safety helpers (ui.js)

- `saveState()` / `loadState()` — localStorage persistence of all user inputs/selections (see `architecture.md`). Every mutator calls `saveState()`.
- `esc(s)` — HTML-escapes every dynamic string injected via innerHTML (food names, labels, dispG, salad parts). Mandatory for any future DB-sourced text (sponsored products, coach branding) — XSS guard.
- `readNum(id)` / `NUM_LIMITS` — clamps age/height/weight to valid ranges (HTML min/max doesn't block typed input); on `change` the input value itself is snapped back.
- `bmiWarnText()` (defined in app.js) — the single source for BMI warning copy, used by both the live screen-0 box and the menu banner.

## Disclaimer Overlay

Shown on page load via HTML (`.disclaimer-overlay` always visible at start). `closeDisclaimer()` sets `display:none`. Cannot be re-opened.

## Design System (style.css v2.0)

- **Accent**: `#4f46e5` (indigo) → `#7c3aed` (violet) gradient
- **Background**: `linear-gradient(135deg, #f0f2f8, #e8ecf7)` fixed
- **App wrapper**: `background: rgba(255,255,255,0.92)` with `backdrop-filter: blur`
- **Shadows**: `--shadow-sm` / `--shadow-md` on cards; hover lifts with `translateY(-1px)`
- **Buttons**: primary = gradient with `box-shadow`; active state = full accent fill
- **Chips/toggles**: active state = solid accent color
- **Summary card**: gradient purple/blue with font-weight 800 on numbers
- **RTL**: `direction: rtl` on body; all layout is RTL-first

## Touch / Mobile Conventions (07/2026 — coach links open on phones)

- **Text inputs ≥ 16px font-size, always** — anything smaller makes iOS Safari force-zoom the page on focus (and it stays zoomed). Applies to every new input: `input[type="number"]`, `.auth-email`, `.picker-input`, `.fld` (coaches.html) are all 16px.
- **Tap targets: min 44px** (Apple HIG) for primary-path controls — `min-height: 44px` on rectangular buttons (`.toggle-btn`, `.btn-primary/secondary/skip/treat`, `.eaten-btn`, `.alt-btn`, `.pill-btn`), 44px diameter on icon circles (`.account-btn`, `.fav-heart`). Secondary chips/tabs (`.chip`, `.cat-tab`) get **min 40px** + `inline-flex; align-items:center`.
- **Deliberately-subtle controls keep their look, grow their hit area**: `.meal-edit-btn` uses padding + negative margin (no layout shift); `.item-remove`/`.treat-remove` (visible 20px circles — padding would paint the background bigger) use a transparent `::before { inset: -12px }` on `position: relative`. `.reset-link` is exempt by design (demoted).
- **White-label text is unbounded** — any header/card sized around "ShapEat" (7 chars) breaks on a real business name. Coach-supplied strings need `min-width: 0` on the flex item (otherwise it can't shrink below content width and overflows instead of wrapping) plus a `clamp()` font-size, scoped to `.coach-branded` so the house logo is untouched. Same for `display_name` anywhere in `coach-dashboard.html`.
- **No horizontal overflow at 320–430px** — fluid base, single 480px breakpoint (account modal only). Verify new screens with the Playwright textual audit (bounding-box sweep of `button/a/input/[role=button]` at 320/390/430 + desktop 1280).

## Save / Print to PDF (implemented)

The menu screen has a "📄 שמירת התפריט" button → `window.print()`. A `@media print` block in `style.css` hides the interactive chrome (nav / treat-bar / progress / eaten+edit buttons / `.coach-cta` / step-bar) so the browser's "save as PDF" yields a clean menu-only sheet — no build step, no library.

## Planned Features

- Interactive food swap on the menu screen
- Coach/trainer version
- Integration with FoodsDictionary API
