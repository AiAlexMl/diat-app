// ══════════════════════════════════════════
//  ui.js — ממשק משתמש: ניווט, רינדור, אירועים
//  גרסה 1.0 | Diet Application
// ══════════════════════════════════════════

let likeCat  = Object.keys(DB)[0];
let avoidCat = Object.keys(DB)[0];
const CATS   = Object.keys(DB);

// escape ל-HTML עבור כל טקסט שמוזרק ל-innerHTML. היום data.js סטטי, אבל ברגע ששמות
// (מוצר ממומן / מאמן) יגיעו ממסד נתונים — בלי זה יש XSS. לעטוף כל שדה דינמי.
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ══════════════════════════════════════════
//  שמירת מצב — רענון דף לא מאבד את ההעדפות (והבסיס ל-profiles של Supabase בהמשך)
// ══════════════════════════════════════════
const STATE_KEY = 'dietai-state';

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      gender: S.gender, goal: S.goal, age: S.age, height: S.height, weight: S.weight,
      diet: [...S.diet], allergy: [...S.allergy], time: S.time, noTrain: S.noTrain,
      liked: [...S.liked], avoided: [...S.avoided],
    }));
  } catch (e) { /* localStorage חסום (מצב פרטי) — ממשיכים בלי שמירה */ }
}

function loadState() {
  let d;
  try { d = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return; }
  if (!d) return;
  try {
    S.gender = d.gender === 'female' ? 'female' : 'male';
    S.goal   = ['cut', 'maintain', 'bulk'].includes(d.goal) ? d.goal : 'maintain';
    ['age', 'height', 'weight'].forEach(k => {
      if (d[k]) { S[k] = d[k]; document.getElementById(k).value = d[k]; }
    });
    S.diet    = new Set(d.diet || []);
    S.allergy = new Set(d.allergy || []);
    S.time    = d.time || null;
    S.liked   = new Set(d.liked || []);
    S.avoided = new Set(d.avoided || []);

    // סנכרון UI למצב המשוחזר
    document.getElementById('male-btn').classList.toggle('active', S.gender === 'male');
    document.getElementById('female-btn').classList.toggle('active', S.gender === 'female');
    ['cut', 'maintain', 'bulk'].forEach(x =>
      document.getElementById(x + '-btn').classList.toggle('active', S.goal === x));
    document.querySelectorAll('.chip').forEach(el => {
      const v = el.dataset.val;
      el.classList.toggle('active', S.diet.has(v));
      el.classList.toggle('active-danger', S.allergy.has(v));
    });
    if (d.noTrain) { S.noTrain = false; toggleNoTrain(); }   // toggleNoTrain מעדכן גם את ה-UI
    else if (S.time) {
      const card = document.querySelector(`.time-card[data-val="${S.time}"]`);
      if (card) setTime(card);
    }
    document.getElementById('like-count').textContent  = S.liked.size;
    document.getElementById('avoid-count').textContent = S.avoided.size;
  } catch (e) { /* מצב פגום — מתעלמים וממשיכים מאפס */ }
}

// ══════════════════════════════════════════
//  היום שלי — שמירת התפריט הנוכחי + סימוני "אכלתי" (הבסיס ללולאת השימוש היומית)
// ══════════════════════════════════════════
const DAY_KEY = 'shapeat-day';
let DAY = null;   // { date, target, meals(live), eaten[], warn{bmi,carb,menu}, gLabel, tLabel }

const FOOD_BY_ID = Object.fromEntries([...ALL, ...TREATS].map(f => [f.id, f]));
// תאריך מקומי (לא UTC!) — toISOString החליף יום רק ב-02:00/03:00 שעון ישראל
const todayStr = () => new Date().toLocaleDateString('en-CA');

// פריט → נתונים שטוחים (בלי refs); משחזרים את f לפי id (תקף גם אחרי adjustEgg/lean-swap)
function serializeDay(day) {
  const item = it => it.isSaladGroup
    ? { salad: true, label: it.label, parts: it.parts, comps: it._comps.map(c => ({ id: c.f.id, g: c.g })),
        oilG: it._oilG || 0, cal: it.cal, p: it.p, c: it.c, fat: it.fat, fib: it.fib }
    : it.f && it.f.id === -1   // פריט ידני ("אכלתי משהו אחר" עם קלוריות בלבד)
    ? { manual: true, name: it.f.name, displayName: it.displayName,
        cal: it.cal, p: it.p, c: it.c, fat: it.fat, fib: it.fib }
    : { id: it.f.id, g: it.g, dispG: it.dispG, displayName: it.displayName,
        cal: it.cal, p: it.p, c: it.c, fat: it.fat, fib: it.fib };
  return {
    date: day.date, buildId: day.buildId || null, target: day.target, fibG: day.fibG || null, eaten: day.eaten, note: day.note || null,
    warn: day.warn, warnAction: day.warnAction || null,
    tips: day.tips || null, gLabel: day.gLabel, tLabel: day.tLabel, morningTip: day.morningTip,
    meals: day.meals.map(m => ({
      label: m.label, icon: m.icon, time: m.time, pct: m.pct, tag: m.tag, type: m.type, removed: m.removed || false, added: m.added || false, edited: m.edited || false,
      totCal: m.totCal, totP: m.totP, totC: m.totC, totF: m.totF, totFib: m.totFib,
      items: m.items.map(item),
    })),
  };
}

function deserializeDay(d) {
  const item = it => it.salad
    ? { isSaladGroup: true, label: it.label, parts: it.parts,
        _comps: it.comps.map(c => ({ f: FOOD_BY_ID[c.id], g: c.g })).filter(c => c.f),
        _oil: FOOD_BY_ID[86] || null, _oilG: it.oilG,
        cal: it.cal, p: it.p, c: it.c, fat: it.fat, fib: it.fib }
    : it.manual
    ? { f: { id: -1, name: it.name, prep: '', tags: [] }, g: 0, dispG: '', displayName: it.displayName,
        cal: it.cal, p: it.p, c: it.c, fat: it.fat, fib: it.fib }
    : { f: FOOD_BY_ID[it.id], g: it.g, dispG: it.dispG, displayName: it.displayName,
        cal: it.cal, p: it.p, c: it.c, fat: it.fat, fib: it.fib };
  return {
    date: d.date, buildId: d.buildId || null, target: d.target, fibG: d.fibG || null, eaten: d.eaten || [], note: d.note || null,
    warn: d.warn || {}, warnAction: d.warnAction || null,
    tips: d.tips || null, gLabel: d.gLabel, tLabel: d.tLabel, morningTip: d.morningTip,
    meals: d.meals.map(m => ({ ...m, items: m.items.map(item).filter(it => it.isSaladGroup || it.f) })),
  };
}

function saveDay() {
  if (!DAY) return;
  try { localStorage.setItem(DAY_KEY, JSON.stringify(serializeDay(DAY))); } catch (e) {}
}

function loadDay() {
  let d;
  try { d = JSON.parse(localStorage.getItem(DAY_KEY)); } catch (e) { return null; }
  if (!d || !d.meals) return null;
  try {
    const day = deserializeDay(d);
    if (day.date !== todayStr()) {           // יום חדש — חוזרים לתפריט הבסיס הנקי
      day.date = todayStr();
      day.buildId = crypto.randomUUID();     // תפריט בסיס חדש = זהות חדשה (הלב מתחיל ריק)
      // מסירים פינוקים, ארוחות שנוספו אגב איזון אמצע-יום (added), וארוחות שהוסרו —
      // כך מחר לא נגרר עם פינוקים של אתמול או נשנושים שצצו תוך כדי. הסימונים מתאפסים.
      // לפי הדגל בלבד: גם buildMenu מוסיף ארוחות בשם "נשנוש נוסף" ליעד גבוה (בלי added) —
      // סינון לפי ה-label מחק אותן מהבסיס של מחר והשאיר יום חסר ~46% (נמדד 10/07/2026).
      day.meals = day.meals.filter(m => m.type !== 'treat' && !m.added && !m.removed);
      day.meals.forEach(m => { m.edited = false; });   // מנעולי אתמול לא נגררים ליום חדש
      day.eaten = day.meals.map(() => false);
      day.note = null;
    }
    if (!day.buildId) {                      // יום שנשמר לפני פיצ'ר הזהות — מקצים ומתמידים מיד,
      day.buildId = crypto.randomUUID();     // אחרת כל רענון היה מגריל מזהה חדש והלב לא היה נדלק לעולם
      try { localStorage.setItem(DAY_KEY, JSON.stringify(serializeDay(day))); } catch (e) {}
    }
    // שחזור הפינוקים המתוכננים מתוך כרטיס הפינוק (כדי שהוספה/הסרה יעבדו אחרי רענון)
    const tm = day.meals.find(m => m.type === 'treat' && !m.removed);
    S.treats = tm ? tm.items.map(it => it.f && it.f.id).filter(id => id > 0) : [];
    return day;
  } catch (e) { return null; }
}

function clearDay() {
  DAY = null;
  editingMeals.clear();   // אינדקסי הארוחות משתנים ביום חדש; בלי זה ארוחה אקראית נפתחת לעריכה
  try { localStorage.removeItem(DAY_KEY); } catch (e) {}
}

// ══════════════════════════════════════════
//  מועדפים — snapshot של תפריט יום ("לב"). מקומי-קודם; הענן מתמזג דרך supabase-client.
//  בכוונה resetApp/clearDay לא נוגעים כאן — תפריט ששמרת שורד איפוס.
// ══════════════════════════════════════════
const FAV_KEY = 'shapeat-favorites';
const FAV_CAP = 30;

function listFavorites() {
  try {
    const l = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(l) ? l.sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1)) : [];
  } catch (e) { return []; }
}

function writeFavorites(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
}

// שומר/מעדכן את התפריט הנוכחי — אידמפוטנטי (שמירה-או-עדכון לפי buildId, אף פעם לא ביטול):
// זרם כוונת-השמירה אחרי login קורא לו ישירות, ולכן אסור שיתנהג כטוגל.
// המפתוח לפי buildId (זהות התפריט) ולא לפי תאריך — כך שני תפריטים שונים באותו יום = שני מועדפים.
// שקט בכוונה — הטוסט מגיע מהעטיפה ב-supabase-client (המקור היחיד למשוב שמירה).
// מחזיר {fav, created} — ה-hook של שכבת הסנכרון (supabase-client עוטף את הפונקציה).
function saveFavorite() {
  if (!DAY) return null;
  const list = listFavorites();
  const now = new Date().toISOString();
  let fav = list.find(f => f.payload && f.payload.buildId && f.payload.buildId === DAY.buildId);
  let created = false;
  if (fav) {
    fav.payload = serializeDay(DAY);
    fav.saved_at = now;
  } else {
    created = true;
    fav = { fav_id: crypto.randomUUID(), date: DAY.date, saved_at: now, payload: serializeDay(DAY) };
    list.unshift(fav);
    while (list.length > FAV_CAP) list.pop();   // הרשימה ממוינת חדש→ישן; מפילים את הישן
  }
  writeFavorites(list);
  updateFavHeart();
  return { fav, created };
}

// לחיצה על הלב = טוגל אמיתי: שמור → ביטול (עם undo בטוסט), לא שמור → שמירה.
// קורא דרך window כדי לעבור בעטיפות הסנכרון של supabase-client כשהן קיימות.
function toggleFavoriteToday() {
  if (!DAY) return;
  const cur = listFavorites().find(f => f.payload && f.payload.buildId && f.payload.buildId === DAY.buildId);
  if (cur) {
    window.removeFavorite(cur.fav_id);
    showToast('הוסר מהמועדפים', 4200, { label: 'ביטול', onClick: () => window.saveFavorite() });
  } else {
    window.saveFavorite();
  }
}

// הסרה — רק ממסך ההיסטוריה. מחזיר את שהוסר (hook לסנכרון).
function removeFavorite(favId) {
  const list = listFavorites();
  const removed = list.find(f => f.fav_id === favId) || null;
  writeFavorites(list.filter(f => f.fav_id !== favId));
  updateFavHeart();
  return removed;
}

function updateFavHeart() {
  const b = document.getElementById('fav-heart');
  if (!b) return;
  // הלב נדלק רק אם התפריט המוצג *עצמו* שמור (לפי buildId), לא סתם כי קיים מועדף כלשהו מהיום
  const saved = !!DAY && listFavorites().some(f => f.payload && f.payload.buildId && f.payload.buildId === DAY.buildId);
  b.classList.toggle('on', saved);
  b.setAttribute('aria-pressed', saved ? 'true' : 'false');
  b.title = saved ? 'שמור במועדפים ✓ (לחיצה תבטל)' : 'שמור למועדפים';
}

// toast קטן לכל האפליקציה (משתמש ב-keyframes toast-pop הקיימים).
// action אופציונלי = { label, onClick } → מוסיף כפתור פעולה (למשל "צפייה" שמוביל לשמורים)
// ומאריך את משך התצוגה כדי שיהיה זמן ללחוץ.
function showToast(msg, ms, action) {
  document.querySelectorAll('.app-toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'app-toast';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (action && action.label) {
    const b = document.createElement('button');
    b.className = 'app-toast-btn';
    b.textContent = action.label;
    b.onclick = () => { t.remove(); try { action.onClick(); } catch (e) {} };
    t.appendChild(b);
  }
  const dur = ms || (action ? 5000 : 2400);
  t.style.animationDuration = dur + 'ms';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

// ── סימון "אכלתי" — עדכון במקום (בלי רינדור מחדש, שומר מיקום גלילה) ──
// כל הארוחות הפעילות (לא-removed) סומנו כנאכלו
function dayComplete() {
  if (!DAY) return false;
  const active = DAY.meals.map((m, i) => ({ m, i })).filter(x => !x.m.removed);
  return active.length > 0 && active.every(x => DAY.eaten[x.i]);
}

// הנפשת קונפטי חוגגת בהשלמת היום. טהור CSS/JS, מכבד prefers-reduced-motion.
function celebrate() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#4f46e5', '#7c3aed', '#22c55e', '#f59e0b', '#ec4899'];
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  for (let k = 0; k < 44; k++) {
    const p = document.createElement('i');
    p.className = 'confetti-piece';
    p.style.left = (Math.random() * 100) + 'vw';
    p.style.background = colors[k % colors.length];
    p.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
    p.style.animationDuration = (1.8 + Math.random() * 1.2).toFixed(2) + 's';
    layer.appendChild(p);
  }
  const toast = document.createElement('div');
  toast.className = 'day-done-toast';
  toast.textContent = 'כל הכבוד! סיימת את היום 🎉';
  layer.appendChild(toast);
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3200);
}

function toggleEaten(i) {
  if (!DAY) return;
  const wasComplete = dayComplete();
  DAY.eaten[i] = !DAY.eaten[i];
  saveDay();
  const card = document.getElementById(`meal-card-${i}`);
  if (card) {
    card.classList.toggle('meal-eaten', DAY.eaten[i]);
    const btn = card.querySelector('.eaten-btn');
    if (btn) {
      btn.textContent = DAY.eaten[i] ? '✓ נאכלה' : 'אכלתי ✓';
      btn.classList.toggle('on', DAY.eaten[i]);
    }
    // ארוחה שנאכלה: יוצאים ממצב עריכה (ה-✏️ מוסתר ב-CSS, ה-✕ נעלמים)
    if (DAY.eaten[i]) {
      card.classList.remove('editing');
      const eb = card.querySelector('.meal-edit-btn');
      if (eb) eb.textContent = '✏️';
    }
  }
  updateDayProgress();
  if (!wasComplete && dayComplete()) celebrate();   // חגיגה רק במעבר ללא-שלם→שלם (לא בטעינת יום מושלם)
}

function updateDayProgress() {
  const box = document.getElementById('day-progress');
  if (!box || !DAY) return;
  const active = DAY.meals.map((m, i) => ({ m, i })).filter(x => !x.m.removed);
  // המכנה = סך קלוריות היום בפועל (כמו הסיכום למטה), לא היעד — כך אכילת הכל = 100% והמספרים זהים
  const totalCal = active.reduce((s, x) => s + x.m.totCal, 0);
  const eatenCal = active.reduce((s, x) => s + (DAY.eaten[x.i] ? x.m.totCal : 0), 0);
  const count = active.filter(x => DAY.eaten[x.i]).length;
  const pct = Math.min(100, Math.round(eatenCal / Math.max(totalCal, 1) * 100));
  box.innerHTML = `
    <div class="dp-row">
      <span>נאכלו ${count}/${active.length} ארוחות</span>
      <span><strong>${eatenCal.toLocaleString()}</strong> / ${totalCal.toLocaleString()} קק"ל</span>
    </div>
    <div class="dp-track"><div class="dp-fill" style="width:${pct}%"></div></div>`;
}

// ══════════════════════════════════════════
//  הסרת פריט בודד מארוחה (מצב עריכה per-meal)
// ══════════════════════════════════════════
// כפתור ✏️ בכותרת הארוחה חושף ✕ על השורות (CSS לפי .editing) — ברירת המחדל נקייה.
// אילו ארוחות פתוחות לעריכה. state אמיתי ולא class על ה-DOM, כי renderDay
// בונה את הכרטיסים מחדש בכל הסרה/הוספה והיה מוחק אותו.
const editingMeals = new Set();

function toggleMealEdit(mi) {
  const card = document.getElementById(`meal-card-${mi}`);
  if (!card) return;
  const editing = !editingMeals.has(mi);
  if (editing) editingMeals.add(mi); else editingMeals.delete(mi);
  card.classList.toggle('editing', editing);
  const btn = card.querySelector('.meal-edit-btn');
  if (btn) btn.textContent = editing ? 'שמירה ✓' : '✏️';
  // כל שינוי נשמר מיד ממילא, אבל בלי אישור מפורש המשתמשת לא יודעת את זה
  // ומחפשת כפתור שמירה. הסגירה היא רגע האישור. (דווח 08/08/2026)
  if (!editing) { closeAddItemPicker(); try { showToast('הארוחה נשמרה ✓'); } catch (e) {} }
}

// אחרי עריכה ידנית: אם היום צנח הרבה מתחת ליעד — אומרים את זה. בלי זה משתמשת
// מוחקת פריטים ומגיעה ל-1100 קק"ל בלי ששום דבר במסך רומז שזו בעיה, בזמן
// שלאפליקציה יש רצפה קלורית מפורשת בבנייה. (דווח 08/08/2026)
function checkDayLevel() {
  if (!DAY) return;
  const live = DAY.meals.filter(m => !m.removed).reduce((s, m) => s + m.totCal, 0);
  const floor = S.gender === 'female' ? 1200 : 1500;
  const mine = w => w && (w.indexOf('התפריט ירד') === 0 || w.indexOf('אחרי העריכות') === 0);
  if (live < floor) {
    DAY.warn.menu = `התפריט ירד לכ-${Math.round(live)} קק"ל, מתחת למינימום הבריא המומלץ (${floor}). ` +
      `זה נמוך מדי ליום שלם.`;
    DAY.warnAction = '⚖️ אזן לערכים המומלצים';
  } else if (live < DAY.target * 0.9) {
    DAY.warn.menu = `אחרי העריכות היום עומד על כ-${Math.round(live)} קק"ל מול יעד של ${DAY.target}.`;
    DAY.warnAction = '⚖️ אזן לערכים המומלצים';
  } else if (mine(DAY.warn.menu)) {
    DAY.warn.menu = null;   // חזרנו לטווח — מסירים את האזהרה שלנו בלבד
    DAY.warnAction = null;
  }
}

// איזון היום חזרה ליעד, מהאזהרה. שתי דרכים, לפי מה שבאמת אפשרי:
// ⚠️ מנעול העריכה מגן על ארוחות שהמשתמשת קבעה, ולכן כשהיא ערכה *את כולן*
// אין מה לאזן. במצב הזה הדרך היחידה חזרה ליעד היא בנייה מחדש, ואת זה
// לא עושים בשקט — שואלים, כי זה מוחק בדיוק את העבודה שהמנעול הגן עליה.
function rebalanceToTarget() {
  if (!DAY) return;
  const openIdx = DAY.meals.some((m, i) => !m.removed && !DAY.eaten[i] && !m.edited && m.type !== 'treat');
  if (openIdx) {
    const res = rebalanceDay(DAY.meals, DAY.eaten);
    DAY.note = res.note || 'איזנו את שאר היום סביב מה שכן תאכל ✓';
    DAY.noteAction = null;
    checkDayLevel();
    saveDay(); renderDay();
    return;
  }
  if (!confirm('כל הארוחות נערכו ידנית, ולכן אין מה לאזן סביבן.\n' +
               'אפשר לבנות תפריט חדש ליעד, אבל זה ימחק את העריכות שלך. להמשיך?')) return;
  DAY.meals.forEach(m => { m.edited = false; });
  renderMenu();
}

// ✕ על פריט = "פשוט דלג": יורד מהארוחה ומהסיכום, שאר היום לא משתנה. הערה מציעה איזון אופציונלי.
function removeItem(mi, ii) {
  if (!DAY || !DAY.meals[mi]) return;
  const meal = DAY.meals[mi];
  meal.items.splice(ii, 1);
  meal.edited = true;   // מנעול: איזון עתידי לא יבנה מחדש ארוחה שהמשתמשת קבעה
  if (!meal.items.length) meal.removed = true;
  recalcMeal(meal);
  if (meal.removed) {
    DAY.note = 'הסרת את כל פריטי הארוחה — היא ירדה מהיום. שאר הארוחות לא השתנו.';
    DAY.noteAction = null;
  } else {
    DAY.note = 'הסרת פריט שלא אכלת — הוא ירד מהתפריט ומהסיכום היומי. שאר הארוחות לא השתנו.';
    DAY.noteAction = { label: '⚖️ אזן את ההמשך', fn: 'balanceAfterRemoval', mi };
  }
  checkDayLevel();
  saveDay();
  renderDay();
}

// "אזן את ההמשך": נועל את הארוחה הערוכה (במה שנשאר בה — המשתמש אכל את השאר) ובונה מחדש
// רק את הארוחות שלא נגעו בהן. אם הארוחה רוקנה לגמרי — פשוט מאזנים את שאר היום.
function balanceAfterRemoval(mi) {
  if (!DAY) return;
  const meal = DAY.meals[mi];

  // אם היום כבר בתוך הסובלנות — לא נוגעים. rebuildRest בונה *ארוחות שלמות* מחדש,
  // וכשנשארו עשרות קלוריות לחלק הכלי גס מדי: הסרת טחינה (89 קק"ל) השאירה את היום
  // על ‎-3%‎, והאיזון העיף אותו ל-‎+7%‎ ואז הזהיר על חריגה שהוא עצמו יצר. (דווח 08/08/2026)
  const live = DAY.meals.filter(m => !m.removed);
  const dev = (live.reduce((s, m) => s + m.totCal, 0) - DAY.target) / Math.max(DAY.target, 1);
  if (Math.abs(dev) <= 0.04) {
    DAY.note = 'היום עדיין בטווח היעד, אין מה לאזן ✓';
    DAY.noteAction = null;
    saveDay(); renderDay();
    return;
  }

  // 🔑 צילום לפני. בנייה מחדש שמרחיקה מהיעד לא מתקבלת.
  // הסרת פריט *מורידה* קלוריות, ולכן היא לא יכולה להקשות על עמידה ביעד חיטוב.
  // כשמשתמשת הסירה טחינה וקיבלה "קשה לעמוד בדיוק ביעד הקלורי", החריגה שעליה
  // הוזהרה נוצרה כולה ע"י הבנייה מחדש: rebuildRest מרכיב ארוחות שלמות מתבניות,
  // וזה כלי גס מדי לפער של עשרות קלוריות. (דווח 08/08/2026)
  const snapshot = JSON.stringify(serializeDay(DAY));
  const devOf = () => Math.abs(
    (DAY.meals.filter(m => !m.removed).reduce((s, m) => s + m.totCal, 0) - DAY.target) /
    Math.max(DAY.target, 1));
  const devBefore = devOf();

  const res = (meal && meal.removed)
    ? rebalanceDay(DAY.meals, DAY.eaten)
    : rebuildRest(DAY.meals, DAY.eaten, mi, meal.items, { markEaten: false });

  if (devOf() > devBefore + 0.005) {          // הורע — מחזירים את היום כפי שהיה
    DAY = deserializeDay(JSON.parse(snapshot));
    DAY.note = 'בדקנו, ואין הרכב שמתקרב ליעד יותר ממה שכבר יש. השארנו את היום כמו שהוא ✓';
    DAY.warn.menu = null;                     // לא מזהירים על חריגה שלא קיימת
    DAY.noteAction = null;
    saveDay(); renderDay();
    return;
  }

  DAY.note = (res.note && (res.note.includes('חצית') || res.note.includes('כמעט מלא')))
    ? res.note
    : 'איזנו את שאר היום סביב מה שכן תאכל ✓ השינוי תקף להיום בלבד.';
  DAY.warn.menu = res.partialWarn || null;
  DAY.noteAction = null;
  saveDay();
  renderDay();
}

// ══════════════════════════════════════════
//  ניווט בין מסכים
// ══════════════════════════════════════════
function goTo(n) {
  updateMacroDisplay();
  document.querySelectorAll('.screen').forEach((s, i) => {
    s.classList.toggle('active', i === n);
    s.style.display = i === n ? 'block' : 'none';
  });
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.toggle('done',   i < n);
    s.classList.toggle('active', i === n);
  });
  if (n === 1) updateTrainWarn();
  if (n === 2) renderGrid('like');
  if (n === 3) renderGrid('avoid');
  window.scrollTo(0, 0);
}

// הסתרת כל המסכים חוץ מהראשון בטעינה
document.querySelectorAll('.screen').forEach((s, i) => {
  s.style.display = i === 0 ? 'block' : 'none';
});

// ══════════════════════════════════════════
//  מסך 1 — פרטים אישיים
// ══════════════════════════════════════════
// לשון נקבה: כפתור "לא מתאמן" לפי מין + מצב הסימון
function noTrainLabel() {
  return gword('לא מתאמן כרגע', 'לא מתאמנת כרגע') + (S.noTrain ? ' ✓' : '');
}

// מחליף את כל הטקסט הסטטי המגדרי (אלמנטים עם data-m/data-f) לפי S.gender — דו-כיווני.
// נקרא מ-setGender (עדכון חי) ומ-init אחרי loadState (לפי המין המשוחזר).
function applyGender() {
  const f = S.gender === 'female';
  document.querySelectorAll('[data-m]').forEach(el => {
    el.textContent = f ? (el.dataset.f || el.dataset.m) : el.dataset.m;
  });
  const nb = document.getElementById('notrain-btn');
  if (nb) nb.textContent = noTrainLabel();
}

// לחיצת לוגו = בית. מציג את היום השמור אם קיים, אחרת מסך הפרטים. לא מאפס דבר.
function goHome() {
  if (DAY && DAY.meals && DAY.meals.length) renderDay();
  else goTo(0);
}

function setGender(g) {
  S.gender = g;
  document.getElementById('male-btn').classList.toggle('active',   g === 'male');
  document.getElementById('female-btn').classList.toggle('active', g === 'female');
  applyGender();
  updateMacroDisplay();
  saveState();
}

function setGoal(g) {
  S.goal = g;
  ['cut','maintain','bulk'].forEach(x => document.getElementById(x + '-btn').classList.remove('active'));
  document.getElementById(g + '-btn').classList.add('active');
  updateMacroDisplay();
  updateTrainWarn();   // מסה ↔ אזהרת מסה-בלי-אימון (מתעדכן אם המשתמש כבר סימן 'לא מתאמן')
  saveState();
}

// טווחים חוקיים לקלט (min/max של ה-HTML לא חוסמים הקלדה ידנית)
const NUM_LIMITS = { age: [18, 60, 28], height: [140, 220, 178], weight: [40, 200, 80] };   // גיל 18+ — אוכלוסיות רגישות (ראו ROADMAP, סעיף משפטי)
function readNum(id) {
  const [lo, hi, def] = NUM_LIMITS[id];
  const v = +document.getElementById(id).value;
  return v ? Math.min(hi, Math.max(lo, v)) : def;
}

// הודעת שגיאה לשדה מספרי אם הערך שהוקלד מחוץ לטווח (אחרת null). ריק = אין שגיאה.
// לגיל: מתחת ל-18 הודעה ייעודית (ללא 60); מעל 60 הודעת טווח.
function fieldError(id) {
  const [lo, hi] = NUM_LIMITS[id];
  const raw = document.getElementById(id).value.trim();
  if (raw === '') return null;
  const v = +raw;
  if (isFinite(v) && v >= lo && v <= hi) return null;
  if (id === 'age')    return v < lo ? 'האפליקציה מיועדת לגילאי 18 ומעלה.' : 'הגיל חייב להיות בין 18 ל-60.';
  if (id === 'height') return 'הגובה חייב להיות בין 140 ל-220 ס"מ.';
  return 'המשקל חייב להיות בין 40 ל-200 ק"ג.';
}
function inputErrors() {
  return ['age', 'height', 'weight'].map(fieldError).filter(Boolean);
}

function updateMacroDisplay() {
  S.age    = readNum('age');
  S.height = readNum('height');
  S.weight = readNum('weight');
  calcMacro();
  document.getElementById('bmr-disp').textContent    = S.bmr.toLocaleString();
  document.getElementById('rmr-disp').textContent    = S.rmr.toLocaleString();
  document.getElementById('target-disp').textContent = S.target.toLocaleString();
  document.getElementById('rmr-box').style.display   = 'flex';

  // כיתוב "אומדן ראשוני" — רק כשהמספר עוד יזוז: שמירה/מסה ולפני בחירת זמן אימון.
  // בחיטוב הגורם נשאר 1.2 גם אחרי אימון, ואחרי בחירת זמן/לא-מתאמן המספר כבר סופי — לכן מוסתר.
  const noteEl = document.getElementById('rmr-note');
  if (noteEl) noteEl.style.display =
    (S.goal !== 'cut' && !S.time && !S.noTrain) ? 'block' : 'none';

  const warn = bmiWarnText();
  const warnBox = document.getElementById('bmi-warn-box');
  warnBox.textContent = warn || '';
  warnBox.style.display = warn ? 'block' : 'none';

  // הודעות ולידציה לקלט (גיל/גובה/משקל מחוץ לטווח) — במקום החלפה שקטה
  const errs = inputErrors();
  const errBox = document.getElementById('input-error');
  if (errBox) {
    errBox.innerHTML = errs.map(esc).join('<br>');
    errBox.style.display = errs.length ? 'block' : 'none';
  }
}

['age','height','weight'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => { updateMacroDisplay(); saveState(); });
  // אין החלפה שקטה של ערך חורג — מוצגת הודעת שגיאה (inputErrors) והמעבר נחסם עד תיקון
});

// מעבר ממסך הפרטים: חוסם אם יש שדה מחוץ לטווח (גיל/גובה/משקל)
function goToFromDetails() {
  if (inputErrors().length) {
    updateMacroDisplay();
    const box = document.getElementById('input-error');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // עצירה מיידית: שילוב מטרה×BMI מזיק נחסם כבר כאן (מטרה+גובה+משקל ידועים) — בלי להמתין לבחירת מאכלים
  const block = buildBlockText();
  if (block) { renderBuildBlock(block); return; }
  goTo(1);
}
loadState();          // שחזור העדפות מביקור קודם (אם יש)
applyGender();         // החלת לשון זכר/נקבה לפי המין המשוחזר
updateMacroDisplay();
DAY = loadDay();      // אם יש תפריט יום שמור — נכנסים ישר אליו ("מלווה יומי")
if (DAY) { renderDay(); }

// ── נגישות מקלדת: אלמנטים אינטראקטיביים שאינם <button> נייטיב (צ'יפים/כרטיסים/טאבים) ──
// הסטטיים מסומנים כאן; הדינמיים מקבלים role/tabindex בתבנית. הפעלה ב-Enter/רווח דרך מאזין מואצל.
document.querySelectorAll('.chip, .time-card').forEach(el => {
  el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const el = e.target.closest && e.target.closest('.chip, .time-card, .cat-tab, .food-card, .picker-item');
  if (el) { e.preventDefault(); el.click(); }
});

// מודאל הדיסקליימר: מיקוד ראשוני + מלכודת פוקוס (Tab לא בורח אל התוכן שמאחור)
(function setupDisclaimerModal(){
  const dlg = document.getElementById('disclaimer-overlay');
  if (!dlg) return;
  if (getComputedStyle(dlg).display !== 'none')
    setTimeout(() => document.getElementById('disclaimer-ack')?.focus(), 60);
  dlg.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('input,button:not([disabled]),a[href]')].filter(el => el.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();

// ══════════════════════════════════════════
//  מסך 2 — העדפות תזונה
// ══════════════════════════════════════════
function toggleDiet(el) {
  const v = el.dataset.val;
  S.diet.has(v) ? S.diet.delete(v) : S.diet.add(v);
  el.classList.toggle('active', S.diet.has(v));
  saveState();
}

function toggleAllergy(el) {
  const v = el.dataset.val;
  S.allergy.has(v) ? S.allergy.delete(v) : S.allergy.add(v);
  el.classList.toggle('active-danger', S.allergy.has(v));
  saveState();
}


// הערת "לא מתאמן" לפי מטרה: חיטוב — שמירת שריר; שמירה — עידוד לאימון; מסה — ריק (האזהרה האדומה היא המסר)
function noTrainNoteText() {
  return {
    cut: 'פעילות אנאירובית מומלצת לשמירת מסת שריר. אירובי יכול לזרז אך אינו חובה.',
    maintain: 'שווה לשלב אימוני כוח (אנאירובי) — הם בונים שריר ומעצבים את הגוף 💪',
    bulk: '',
  }[S.goal] || '';
}

// אזהרה חיה: מסה בלי אימון (מקור יחיד — trainWarnText ב-app.js) + רענון הערת ה"לא מתאמן" לפי מטרה
function updateTrainWarn() {
  const box = document.getElementById('train-warn');
  if (box) {
    const w = trainWarnText();
    box.textContent = w || '';
    box.style.display = w ? 'block' : 'none';
  }
  if (S.noTrain) {   // כשנבחר "לא מתאמן" — ההערה תלוית-מטרה (מתרעננת גם אם המטרה השתנתה)
    const n = document.getElementById('time-note');
    if (n) { const t = noTrainNoteText(); n.textContent = t; n.style.display = t ? 'block' : 'none'; }
  }
}

function setTime(el) {
  if (S.noTrain) {   // מעבר מ"לא מתאמן" לבחירת זמן — מבטלים אוטומטית את "לא מתאמן" (מעבר טבעי)
    S.noTrain = false;
    const nb = document.getElementById('notrain-btn');
    nb.textContent = noTrainLabel();
    nb.style.borderStyle = 'dashed';
  }
  document.querySelectorAll('.time-card').forEach(c => c.classList.remove('active'));
  S.time = el.dataset.val;
  el.classList.add('active');
  const notes = {
    morning: 'קיבה ריקה לאימון — אחרי האימון ארוחה גדולה.',
    noon:    'לפני האימון ארוחת צהריים גדולה, 3 שעות הפסקה, אחר כך אימון.',
    evening: 'ארוחה גדולה ב-17:30 לפני האימון, קלילה אחרי האימון.',
  };
  const n = document.getElementById('time-note');
  n.style.display = 'block';
  n.textContent = notes[S.time];
  updateTrainWarn();
  saveState();
}

function toggleNoTrain() {
  S.noTrain = !S.noTrain;
  const btn = document.getElementById('notrain-btn');
  btn.textContent   = noTrainLabel();
  btn.style.borderStyle = S.noTrain ? 'solid' : 'dashed';
  const n = document.getElementById('time-note');
  if (S.noTrain) {
    document.querySelectorAll('.time-card').forEach(c => c.classList.remove('active'));
    S.time = null;
    // הערת ה"לא מתאמן" (תלוית-מטרה) מוגדרת ב-updateTrainWarn למטה
  } else {
    n.style.display = 'none';
  }
  updateTrainWarn();
  saveState();
}

// ══════════════════════════════════════════
//  מסכים 3 + 4 — בחירת מאכלים
// ══════════════════════════════════════════
function renderGrid(mode) {
  const cat = mode === 'like' ? likeCat : avoidCat;
  const cls = mode === 'like' ? 'active-like' : 'active-avoid';
  const tabsEl = document.getElementById(mode + '-tabs');
  const gridEl = document.getElementById(mode + '-grid');

  tabsEl.innerHTML = CATS.map(c => {
    const count = DB[c].filter(f => mode === 'like' ? S.liked.has(f.id) : S.avoided.has(f.id)).length;
    const badge = count > 0 ? `<span class="tab-badge">${count}</span>` : '';
    return `<div class="cat-tab${c === cat ? ' ' + cls : ''}" role="button" tabindex="0" onclick="selectCat('${mode}','${c}')">${c}${badge}</div>`;
  }).join('');

  gridEl.innerHTML = DB[cat].map(f => {
    const on = mode === 'like' ? S.liked.has(f.id) : S.avoided.has(f.id);
    return `<div class="food-card${on ? (mode === 'like' ? ' liked' : ' avoided') : ''}" role="button" tabindex="0"
                 onclick="toggleFood('${mode}',${f.id})" id="${mode}-${f.id}">
      <div class="fc-icon">${mode === 'like' ? (on ? '❤️' : '🤍') : (on ? '🚫' : '✓')}</div>
      <div class="fc-name">${esc(f.name)}</div>
      ${f.prep ? `<div class="fc-prep">${esc(f.prep)}</div>` : ''}
    </div>`;
  }).join('');
}

function selectCat(mode, cat) {
  if (mode === 'like') likeCat = cat; else avoidCat = cat;
  renderGrid(mode);
}

function toggleFood(mode, id) {
  const set = mode === 'like' ? S.liked : S.avoided;
  set.has(id) ? set.delete(id) : set.add(id);
  document.getElementById(mode + '-count').textContent = set.size;
  const card = document.getElementById(`${mode}-${id}`);
  const on   = set.has(id);
  card.classList.toggle(mode === 'like' ? 'liked' : 'avoided', on);
  card.querySelector('.fc-icon').textContent =
    mode === 'like' ? (on ? '❤️' : '🤍') : (on ? '🚫' : '✓');
  updateTabBadges(mode);
  saveState();
}

function updateTabBadges(mode) {
  const cat = mode === 'like' ? likeCat : avoidCat;
  const cls = mode === 'like' ? 'active-like' : 'active-avoid';
  const tabs = document.getElementById(mode + '-tabs').querySelectorAll('.cat-tab');
  CATS.forEach((c, i) => {
    const tab = tabs[i];
    if (!tab) return;
    const count = DB[c].filter(f => mode === 'like' ? S.liked.has(f.id) : S.avoided.has(f.id)).length;
    const existing = tab.querySelector('.tab-badge');
    if (count > 0) {
      if (existing) existing.textContent = count;
      else tab.insertAdjacentHTML('beforeend', `<span class="tab-badge">${count}</span>`);
    } else if (existing) {
      existing.remove();
    }
  });
}

// ══════════════════════════════════════════
//  מסך 5 — רינדור תפריט
// ══════════════════════════════════════════
function renderMenu() {
  editingMeals.clear();   // תפריט חדש = אינדקסים חדשים
  updateMacroDisplay();
  if (inputErrors().length) { goTo(0); updateMacroDisplay(); return; }   // קלט לא תקין — חזרה למסך הפרטים עם השגיאה
  if (!S.target) { alert('יש למלא פרטים אישיים'); goTo(0); return; }

  // שילוב מטרה×BMI מזיק (חיטוב בתת-משקל / מסה בהשמנה דרגה 2) = hard-stop, מפנים למקצוען
  const block = buildBlockText();
  if (block) { renderBuildBlock(block); return; }

  const meals = buildMenu();
  const treatMeal = meals.find(m => m.type === 'treat');
  DAY = {
    date: todayStr(), buildId: crypto.randomUUID(),   // זהות התפריט הזה — הלב נדלק רק כשהמזהה הזה שמור
    target: S.target, fibG: S.fibG,
    meals, eaten: meals.map(() => false),
    note: treatMeal ? treatBuildNote(treatMeal.items) : null,
    warn: { bmi: S.bmiWarning, train: S.trainWarning, carb: S.carbWarning, menu: S.menuWarning,
            calFloor: S.calFloorWarning,
            kosherSep: S.kosherSep ? 'בכשרות שמרנו על הפרדה של 6 שעות בין הארוחה הבשרית לחלבית, לכן החלב מרוכז בבוקר ובארוחות שאינן צמודות לבשר.' : null },
    tips: dietTips(),
    gLabel: { cut: 'חיטוב', maintain: 'שמירה', bulk: 'מסה' }[S.goal],
    tLabel: S.noTrain || !S.time ? 'ללא אימון'
      : { morning: 'אימון בוקר', noon: 'אימון צהריים', evening: 'אימון ערב' }[S.time],
    morningTip: S.time === 'morning',
  };
  saveDay();
  renderDay();
}

// כרטיס הפניה במקום תפריט — כשהשילוב מטרה×BMI מזיק (buildBlockText). לא בונה ולא שומר DAY.
function renderBuildBlock(msg) {
  const cta = S.gender === 'female' ? 'בואי' : 'בוא';
  document.getElementById('menu-output').innerHTML = `
    <div class="menu-header">
      <h1 class="menu-title">רגע, ${cta} נעצור כאן</h1>
    </div>
    <div class="field-error" style="display:flex;gap:8px;align-items:flex-start">
      <span class="bmi-warning-icon">🩺</span>
      <span>${esc(msg)}</span>
    </div>
    <div class="nav-btns" style="margin-top:16px">
      <button class="btn-secondary" onclick="goTo(0)">← חזרה לפרטים</button>
    </div>`;
  goTo(4);
}

// בונה את ה-HTML של יום — משותף למסך התפריט החי ולתצוגת קריאה-בלבד (היסטוריה/מועדפים).
// opts.readOnly: בלי כרום אינטראקטיבי (התקדמות/פינוקים/עריכה/כפתורים) ובלי id-ים של כרטיסים,
// כדי שהעדכונים-במקום (toggleEaten) לא יפגעו בעותק שבמודאל. opts.title: כותרת חלופית.
function dayHtml(day, opts) {
  const ro    = !!(opts && opts.readOnly);
  const meals = day.meals;
  const dCal  = meals.reduce((s, m) => s + m.totCal, 0);
  const dP    = Math.round(meals.reduce((s, m) => s + m.totP, 0));
  const dC    = Math.round(meals.reduce((s, m) => s + m.totC, 0));
  const dF    = Math.round(meals.reduce((s, m) => s + m.totF, 0));
  const dFib  = Math.round(meals.reduce((s, m) => s + (m.totFib || 0), 0));
  const pPct  = Math.round(dP * 4 / Math.max(dCal, 1) * 100);
  const cPct  = Math.round(dC * 4 / Math.max(dCal, 1) * 100);
  const fPct  = 100 - pPct - cPct;

  // תווית אימון מוצגת רק כשהיא נושאת מידע; "ללא אימון" נשאר כנתון (תנאי הפינוקים) אך לא מוצג — כדי לא להעמיס ליד הלב
  const showSub = day.tLabel && day.tLabel !== 'ללא אימון';
  let html = `<div class="menu-header">
    <h1 class="menu-title">${opts && opts.title ? esc(opts.title) : `התפריט שלך — ${esc(day.gLabel || '')}`}</h1>
    ${showSub ? `<div class="menu-sub">${esc(day.tLabel)}</div>` : ''}
    ${ro ? '' : `<button class="fav-heart" id="fav-heart" onclick="toggleFavoriteToday()" aria-pressed="false" aria-label="שמירת התפריט למועדפים" title="שמור למועדפים"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg></button>`}
  </div>`;
  if (!ro) html += `<div class="day-progress" id="day-progress"></div>`;

  // כפתור פינוק: הוספה או הסרה (התפריט נבנה מחדש סביב הפינוק)
  const hasTreat = meals.some(m => m.type === 'treat' && !m.removed);
  if (!ro) {
    html += `<div class="treat-bar">` +
      `<button class="btn-treat" onclick="openTreatPicker()">🍫 ${hasTreat ? 'עוד פינוק' : 'בא לי פינוק היום'}</button>` +
      (hasTreat ? `<button class="btn-treat on" onclick="removeTreat()">✕ הסר פינוקים</button>` : '') +
      `</div>`;
  }

  // אזהרת BMI
  if (day.warn.bmi) {
    html += `<div class="bmi-warning">
      <span class="bmi-warning-icon">⚠️</span>
      <span>${esc(day.warn.bmi)}</span>
    </div>`;
  }

  // אזהרה חריפה: מסה בלי אימון
  if (day.warn.train) {
    html += `<div class="field-error">
      <span class="bmi-warning-icon">⚠️</span>
      <span>${esc(day.warn.train)}</span>
    </div>`;
  }

  // אזהרת פחמימות נמוכות
  if (day.warn.carb) {
    html += `<div class="bmi-warning info-warning">
      <span class="bmi-warning-icon">ℹ️</span>
      <span>${esc(day.warn.carb)}</span>
    </div>`;
  }

  // אזהרת אי-התאמה: לא ניתן לעמוד ביעד הקלורי עם ההעדפות הנוכחיות
  if (day.warn.menu) {
    html += `<div class="bmi-warning info-warning">
      <span class="bmi-warning-icon">ℹ️</span>
      <span>${esc(day.warn.menu)}` +
      // כפתור על האזהרה עצמה, לא רק על ההערה: האזהרה היא המקום שבו המשתמשת
      // מבינה שיש בעיה, ושם צריכה להיות גם הדרך לתקן אותה.
      (!ro && day.warnAction ? ` <button class="note-action" onclick="rebalanceToTarget()">${esc(day.warnAction)}</button>` : '') +
      `</span>
    </div>`;
  }

  // הערת כשרות: הפרדת 6 שעות בשר/חלב (מוצג רק בכשר+אוכל-כול, כשיש ארוחה שנחסמה לחלב)
  if (day.warn.kosherSep) {
    html += `<div class="bmi-warning info-warning">
      <span class="bmi-warning-icon">ℹ️</span>
      <span>${esc(day.warn.kosherSep)}</span>
    </div>`;
  }

  // הערת שקיפות: היעד הועלה לרצפה הקלורית הבריאה
  if (day.warn.calFloor) {
    html += `<div class="bmi-warning info-warning">
      <span class="bmi-warning-icon">ℹ️</span>
      <span>${esc(day.warn.calFloor)}</span>
    </div>`;
  }

  // הודעת היום (תיקון יום: "כמעט מלא" / "חצית את היעד") + פעולה אופציונלית (אזן אחרי הסרה)
  if (day.note) {
    html += `<div class="day-note">${esc(day.note)}` +
      (!ro && day.noteAction ? ` <button class="note-action" onclick="${day.noteAction.fn}(${day.noteAction.mi})">${esc(day.noteAction.label)}</button>` : '') +
      `</div>`;
  }

  // הערה לאימון בוקר
  if (day.morningTip) {
    html += `<div class="tips-box" style="margin-bottom:10px">
      אימון בוקר על קיבה ריקה — אם מרגישים צורך, בננה אחת או תמר לפני האימון יספיקו.
    </div>`;
  }

  meals.forEach((m, mi) => {
    if (m.removed) return;   // ארוחה שהוסרה בתיקון יום (חצה את היעד)
    const tagH = m.tag
      ? `<span class="meal-tag ${m.tag === 'pre' ? 'tag-pre' : 'tag-post'}">${m.tag === 'pre' ? 'לפני אימון' : 'אחרי אימון'}</span>`
      : '';

    // מצב העריכה נקרא מ-editingMeals ולא מה-DOM: renderDay בונה את ה-HTML מחדש
    // אחרי כל הסרה/הוספה, וכשהמצב ישב רק כ-class הארוחה נפלה מעריכה בכל פעולה.
    const isEd = !ro && editingMeals.has(mi);
    html += `<div class="meal-card${day.eaten[mi] ? ' meal-eaten' : ''}${m.type === 'treat' ? ' treat-card' : ''}${isEd ? ' editing' : ''}"${ro ? '' : ` id="meal-card-${mi}"`}>
      <div class="meal-header">
        <div class="meal-title">${m.type === 'treat' ? '🍫 ' : ''}${esc(m.label)} ${tagH}</div>
        <div style="display:flex;align-items:center;gap:8px">
          ${m.type === 'treat' ? `<span class="meal-time">מתי שמתחשק 🙂</span>` : m.time ? `<span class="meal-time">${m.time}</span>` : ''}
          <span class="meal-cal">${m.totCal} קל׳</span>
          ${!ro && m.type !== 'treat' ? `<button class="meal-edit-btn" onclick="toggleMealEdit(${mi})" title="${isEd ? 'שמירת הארוחה' : 'ערוך ארוחה'}">${isEd ? 'שמירה ✓' : '✏️'}</button>` : ''}
        </div>
      </div>`;
    // למתאמנים: עדיף להרחיק את הפינוק מחלון האימון (תגי לפני/אחרי אימון שמורים לארוחות עצמן)
    if (m.type === 'treat' && m.totCal > 0 && day.tLabel && day.tLabel !== 'ללא אימון') {
      html += `<div class="treat-tip">💡 טיפ: הארוחות שלפני ואחרי האימון בנויות בדיוק בשבילו (פחמימה + חלבון) — את הפינוק עדיף לשמור רחוק מחלון האימון, לא במקומן.</div>`;
    }

    if (m.items.length === 0) {
      html += `<div class="empty-meal-note">לא נמצאו מזונות מתאימים לארוחה זו. נסה להסיר חלק מהמאכלים המוחרגים.</div>`;
    }

    m.items.forEach((it, ii) => {
      const rm = ro ? ''
        : m.type === 'treat'
        ? `<button class="treat-remove" onclick="removeTreatItem(${ii})" title="הסר פינוק">✕</button>`
        : `<button class="item-remove" onclick="removeItem(${mi},${ii})" title="הסר פריט">✕</button>`;
      if (it.isSaladGroup) {
        html += `<div class="salad-row">
          <div class="salad-header">
            <span class="food-row-name">${rm}${esc(it.label)}</span>
            <div class="food-row-right">
              <span class="food-row-cal">${it.cal} קל׳</span>
            </div>
          </div>
          <div class="salad-items">${it.parts.map(esc).join(' + ')}</div>
        </div>`;
      } else {
        const rowName = (() => {
          if (it.displayName) return it.displayName;
          if (!it.f.prep) return it.f.name;
          const firstWord = it.f.prep.split(/[\s\/]/)[0];
          return it.f.name.includes(firstWord) ? it.f.name : `${it.f.name} ${it.f.prep}`;
        })();
        // פריט ידני (id -1) אינו במאגר ואין לו תמונה — בלי זה נשלחת בקשה ל-images/-1.jpg
        // שנכשלת בכל רינדור ומלכלכת את הקונסולה.
        const imgSrc = it.f.img || (it.f.id >= 0 ? `images/${it.f.id}.jpg` : null);
        const thumb = imgSrc
          ? `<span class="food-thumb"><img src="${esc(imgSrc)}" alt="${esc(it.f.name)}" loading="lazy" onerror="this.parentElement.style.display='none'"></span>`
          : '';
        html += `<div class="food-row">
          <span class="food-row-name">${rm}${thumb}${esc(rowName)}</span>
          <div class="food-row-right">
            ${it.dispG ? `<span class="food-row-amount">${esc(it.dispG)}</span>` : ''}
            <span class="food-row-cal">${it.cal} קל׳</span>
          </div>
        </div>`;
      }
    });

    html += `<div class="macro-row">
      <div class="macro-pill"><div class="val">${m.totP}g</div><div class="lbl">חלבון</div></div>
      <div class="macro-pill"><div class="val">${m.totC}g</div><div class="lbl">פחמימות</div></div>
      <div class="macro-pill"><div class="val">${m.totF}g</div><div class="lbl">שומן</div></div>
    </div>`;
    if (!ro) {
      html += `<div class="meal-actions">
      ${m.type !== 'treat' ? `<button class="alt-btn add-item-btn" onclick="openAddItemPicker(${mi})">➕ הוסף פריט</button>` : ''}
      ${m.type !== 'treat' ? `<button class="alt-btn" onclick="openAltPicker(${mi})">🔄 אכלתי משהו אחר</button>` : ''}
      <button class="eaten-btn${day.eaten[mi] ? ' on' : ''}" onclick="toggleEaten(${mi})">${day.eaten[mi] ? '✓ נאכלה' : 'אכלתי ✓'}</button>
    </div>`;
    }
    html += `</div>`;
  });

  html += `<div class="summary-card">
    <div class="summary-title">סיכום יומי</div>
    <div class="summary-grid">
      <div class="sum-metric"><div class="val">${dCal.toLocaleString()}</div><div class="lbl">קלוריות</div></div>
      <div class="sum-metric"><div class="val">${dP}g</div><div class="lbl">חלבון</div></div>
      <div class="sum-metric"><div class="val">${dC}g</div><div class="lbl">פחמימות</div></div>
      <div class="sum-metric"><div class="val">${dF}g</div><div class="lbl">שומן</div></div>
    </div>
    <div class="bar-row">
      <span class="bar-lbl">חלבון</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pPct}%;background:#378ADD"></div></div>
      <span style="font-size:12px;color:var(--text-tert);width:30px">${pPct}%</span>
    </div>
    <div class="bar-row">
      <span class="bar-lbl">פחמימות</span>
      <div class="bar-track"><div class="bar-fill" style="width:${cPct}%;background:#1D9E75"></div></div>
      <span style="font-size:12px;color:var(--text-tert);width:30px">${cPct}%</span>
    </div>
    <div class="bar-row">
      <span class="bar-lbl">שומן</span>
      <div class="bar-track"><div class="bar-fill" style="width:${fPct}%;background:#EF9F27"></div></div>
      <span style="font-size:12px;color:var(--text-tert);width:30px">${fPct}%</span>
    </div>
    <div class="fiber-row">
      <span>סיבים תזונתיים</span>
      <span class="fiber-val">${day.fibG
        ? `<span dir="ltr" class="fiber-num"><strong>${dFib}</strong> / ${day.fibG}g</span>${dFib >= day.fibG ? ' <span class="fiber-ok">✓</span>' : ''}`
        : `<strong>${dFib}g</strong>`}</span>
    </div>
    <div class="tips-box" style="margin-top:12px">
      פעילות אנאירובית מומלצת לשמירת מסת שריר. אירובי יכול לזרז את התהליך אך אינו חובה.
    </div>
  </div>`;

  // טיפים קלילים (B12 לטבעוני, מים לכולם)
  if (day.tips && day.tips.length) {
    html += `<div class="tips-box" style="margin-top:12px">${day.tips.map(esc).join('<br>')}</div>`;
  }

  if (!ro) {
    // פעולות שקטות: "היום הוא המוצר" — ייצור תפריט חוזר הוא פעולה משנית, לא ה-CTA של המסך.
    // הדפסה/PDF: חסומה כשיש פינוק (hasTreat מחושב למעלה) — תפריט מודפס עם פינוק יוצא בחוסר מאקרו
    // (הפינוק שמר תקציב), ולהציג פינוק במסמך "רשמי" לא מקצועי. מסירים את הפינוק ואז מדפיסים נקי.
    html += `
  <div class="menu-quiet-actions">
    <button class="pill-btn" onclick="if (confirmRebuild()) renderMenu()">↻ תפריט נוסף</button>
    ${hasTreat
      ? `<button class="pill-btn" disabled title="הסר את הפינוק כדי לשמור תפריט נקי">📄 שמירה כ-PDF</button>`
      : `<button class="pill-btn" onclick="window.print()">📄 שמירה כ-PDF</button>`}
    <button class="pill-btn" onclick="shareDay()">📤 שיתוף</button>
  </div>${hasTreat
    ? `<div class="print-hint" style="text-align:center;margin-top:6px;font-size:12px;color:var(--text-tert)">📄 כדי לשמור תפריט נקי, הסר קודם את הפינוק 🙂</div>`
    : ''}
  <button class="reset-link" onclick="resetApp()">התחל מחדש (איפוס)</button>
  <div class="coach-cta" style="text-align:center;margin-top:18px;font-size:13px;color:#8b8fa3">
    <a href="coaches.html" style="color:#4f46e5;text-decoration:none;font-weight:600">מאמן/ה?</a>
    יש לך גרסה משלך — ממותגת בשמך, למתאמנים שלך ←
  </div>`;
  }

  return html;
}

// מציג את היום השמור (DAY) — נקרא גם אחרי בנייה וגם בשחזור מ-localStorage
function renderDay() {
  if (!DAY) return;
  // goTo מסיים ב-scrollTo(0,0). בבנייה ראשונה זה נכון, אבל בעריכה באמצע היום
  // זה זורק את המשתמשת לראש העמוד אחרי כל הסרה/הוספה. שומרים ומחזירים.
  const onDay = document.querySelectorAll('.screen')[4] &&
                document.querySelectorAll('.screen')[4].style.display === 'block';
  const y = window.scrollY;
  document.getElementById('menu-output').innerHTML = dayHtml(DAY, {});
  updateDayProgress();
  updateFavHeart();
  goTo(4);
  if (onDay) window.scrollTo(0, y);
}

// שיתוף היום כטקסט (Web Share במובייל, וואטסאפ בדסקטופ) — לולאת ההפצה האורגנית
function shareDay() {
  if (!DAY) return;
  const lines = ['התפריט שלי להיום 🥗', ''];
  let cal = 0, prot = 0;
  DAY.meals.forEach(m => {
    if (m.removed || !m.items.length) return;
    cal += m.totCal; prot += m.totP || 0;
    const names = m.items.map(it => it.isSaladGroup ? it.label : (it.displayName || it.f.name));
    lines.push(`${m.type === 'treat' ? '🍫' : '🍽️'} ${m.label} (${m.totCal} קל׳): ${names.join(', ')}`);
  });
  lines.push('', `סה"כ: ${cal.toLocaleString()} קל׳ · ${Math.round(prot)}g חלבון`, '',
    'נבנה עם ShapEat, תפריט תזונה אישי בחינם:', 'https://shapeat.co.il');
  const text = lines.join('\n');
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
}

// ══════════════════════════════════════════
//  בורר פינוקים — התפריט נבנה מחדש סביב הפינוק שנבחר
// ══════════════════════════════════════════
// אם כבר סומנו ארוחות היום — בנייה מחדש תאפס אותן; מבקשים אישור
function confirmRebuild() {
  if (!DAY) return true;
  const marks = DAY.eaten && DAY.eaten.some(Boolean);
  const edits = DAY.meals && DAY.meals.some(m => m.edited);
  // עריכות ידניות שוות אזהרה בדיוק כמו סימונים. הן עבודה שהמשתמשת עשתה,
  // ובנייה חדשה מוחקת אותן. (דווח 08/08/2026)
  if (edits && marks) return confirm('בניית תפריט חדש תמחק את העריכות שלך ותאפס את סימוני "אכלתי". להמשיך?');
  if (edits)          return confirm('בניית תפריט חדש תמחק את הארוחות שערכת ידנית. להמשיך?');
  if (marks)          return confirm('בניית תפריט חדש תאפס את סימוני "אכלתי" של היום. להמשיך?');
  return true;
}

function openTreatPicker() {
  closeTreatPicker();
  const ov = document.createElement('div');
  ov.className = 'picker-overlay';
  ov.id = 'treat-picker';
  ov.innerHTML = `<div class="picker-box">
    <div class="picker-title">מה בא לך היום? 🍫</div>
    <div class="picker-sub">התפריט ייבנה מחדש כך שהפינוק נכנס ביעד היומי</div>
    <div class="picker-list">` + TREATS.map(tr =>
      `<div class="picker-item" role="button" tabindex="0" onclick="chooseTreat(${tr.id})">
        <span>${esc(tr.name)} <small>(${esc(tr.unitLabel)})</small></span>
        <span class="picker-cal">${Math.round(tr.cal * tr.unitG / 100)} קק"ל</span>
      </div>`).join('') + `</div>
    <div class="picker-sub" style="margin:12px 0 6px">לא ברשימה? הזינו בעצמכם:</div>
    <div class="ai-qty">
      <label style="flex:1.4"><span>מה הפינוק</span>
        <input id="treat-name" class="picker-input" placeholder="למשל: עוגה של אמא"></label>
      <label><span>כמה קלוריות</span>
        <input id="treat-cal" class="picker-input" type="number" min="0" inputmode="numeric" placeholder="בערך"></label>
    </div>
    <button class="btn-secondary" style="width:100%" onclick="chooseManualTreat()">➕ הוסף פינוק</button>
    <div id="treat-feedback" class="ai-feedback"></div>
    <button class="btn-secondary picker-cancel" onclick="closeTreatPicker()">ביטול</button>
  </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeTreatPicker(); });
  document.body.appendChild(ov);
}

// פינוק שאינו ברשימה. אותו מסלול בדיוק כמו פינוק רגיל, רק שהפריט נבנה
// מ-manualItem (מאקרו שמרני: p=0, 60/40 פחמימה/שומן) כמו בטאב הידני של
// "אכלתי משהו אחר". (ביקשה מיטלי 08/08/2026)
function chooseManualTreat() {
  const nEl = document.getElementById('treat-name');
  const cEl = document.getElementById('treat-cal');
  const fb  = document.getElementById('treat-feedback');
  const name = (nEl && nEl.value || '').trim();
  const cal  = cEl ? parseFloat(cEl.value) : NaN;
  const say = (m, err) => { if (fb) { fb.textContent = m; fb.className = 'ai-feedback' + (err ? ' err' : ' ok'); } };
  if (!name)            { say('מה הפינוק?', true); return; }
  if (!(cal >= 0))      { say('כמה קלוריות בערך?', true); return; }
  if (cal > 3000)       { say('נראה גבוה מדי, בדקו את המספר', true); return; }
  chooseTreat(manualItem(name, cal));
}

function closeTreatPicker() {
  const el = document.getElementById('treat-picker');
  if (el) el.remove();
}

// נוסח הערת הפינוק בבנייה: אפס-קלוריות = "על חשבון הבית"; אחרת ההסבר הרגיל (סכום הקלוריות לכמה פינוקים)
function treatBuildNote(items) {
  if (!items || !items.length) return null;
  const tCal = items.reduce((s, it) => s + it.cal, 0);
  if (tCal === 0) return '🥤 על חשבון הבית — בלי קלוריות, בלי השפעה על התפריט. תיהנה!';
  const name = items.length === 1 ? items[0].f.name : `${items.length} פינוקים`;
  return `התפריט נבנה סביב הפינוק שביקשת ✓ — ${name} (${tCal} קק"ל) הוקצה מתוך היעד היומי, ושאר הארוחות הותאמו בהתאם.`;
}

// הודעת ה-rebalance: שומרים את הודעות המדרגות (כמעט מלא / חצית), אחרת נוסח פינוק ייעודי
function treatNote(res, fallback) {
  return res.note && (res.note.includes('חצית') || res.note.includes('כמעט מלא')) ? res.note : fallback;
}

function chooseTreat(idOrItem) {
  closeTreatPicker();
  // פינוק ידני מגיע כפריט מוכן (manualItem) ולא כ-id
  const manual = !!idOrItem && typeof idOrItem === 'object';
  const tf = manual ? null : FOOD_BY_ID[idOrItem];
  if (!manual && !tf) return;
  if (!S.treats) S.treats = [];
  if (manual && !DAY) return;

  // באמצע יום: לא מאפסים כלום — מוסיפים לכרטיס הפינוק ומעדכנים רק את ההמשך.
  // "אמצע יום" הוא גם ארוחה *שנערכה ידנית* ולא רק ארוחה שסומנה כנאכלה: משתמשת
  // שערכה ארוחות, ביטלה סימון והוסיפה פינוק איבדה את כל עבודתה, כי בלי סימונים
  // הקוד נפל ל-renderMenu() שבונה הכל מאפס. (דווח 08/08/2026)
  // פינוק ידני אינו קיים במאגר ואין לו id, ולכן buildMenu לא יכול לשריין לו תקציב
  // בבנייה מלאה. הוא תמיד עובר במסלול אמצע-היום: מתווסף לכרטיס וההמשך מתאזן סביבו.
  const hasManualWork = DAY && (DAY.eaten.some(Boolean) || DAY.meals.some(m => m.edited));
  if (manual || hasManualWork) {
    if (!manual) S.treats.push(idOrItem);
    const it = manual ? idOrItem : mkItem(tf, tf.unitG);
    let ti = DAY.meals.findIndex(m => m.type === 'treat' && !m.removed);
    if (ti >= 0) {
      DAY.meals[ti].items.push(it);
      recalcMeal(DAY.meals[ti]);
    } else {
      const tm = { label: 'פינוק', icon: 'gift', time: '', pct: 0, tag: null, type: 'treat', big: false, items: [it], removed: false };
      recalcMeal(tm);
      DAY.meals.push(tm);
      DAY.eaten.push(false);
    }
    const res = rebalanceDay(DAY.meals, DAY.eaten);
    DAY.note = treatNote(res, it.cal === 0
      ? 'הפינוק נוסף — בלי קלוריות, בלי השפעה על היום ✓'
      : 'הפינוק נוסף והמשך היום עודכן סביבו ✓ — השינוי תקף להיום בלבד.');
    DAY.warn.menu = res.partialWarn || null;
    saveDay();
    renderDay();
    return;
  }

  S.treats.push(idOrItem);
  renderMenu();   // אין סימונים ואין עריכות — בנייה מלאה סביב הפינוקים (אין מה לאפס)
}

function removeTreat() {
  const ti = DAY ? DAY.meals.findIndex(m => m.type === 'treat' && !m.removed) : -1;

  // באמצע יום: מסירים את כרטיס הפינוק (אם טרם נאכל) ומעדכנים את ההמשך.
  // גם כאן "אמצע יום" כולל עריכה ידנית, לא רק סימון (ראו chooseTreat).
  if (DAY && (DAY.eaten.some(Boolean) || DAY.meals.some(m => m.edited)) && ti >= 0 && !DAY.eaten[ti]) {
    DAY.meals[ti].removed = true;
    DAY.meals[ti].items = [];
    recalcMeal(DAY.meals[ti]);
    S.treats = [];
    const res = rebalanceDay(DAY.meals, DAY.eaten);
    DAY.note = treatNote(res, 'הפינוקים הוסרו וההמשך עודכן ✓');
    DAY.warn.menu = res.partialWarn || null;
    saveDay();
    renderDay();
    return;
  }

  if (!confirmRebuild()) return;
  S.treats = [];
  renderMenu();
}

// הסרת פינוק בודד מתוך כרטיס הפינוק (משחרר תקציב → מאזן מחדש את ההמשך, בניגוד להסרת פריט רגיל)
function removeTreatItem(idx) {
  if (!DAY) return;
  const ti = DAY.meals.findIndex(m => m.type === 'treat' && !m.removed);
  if (ti < 0) return;
  const meal = DAY.meals[ti];
  meal.items.splice(idx, 1);
  if (S.treats) S.treats.splice(idx, 1);
  if (!meal.items.length) meal.removed = true;
  recalcMeal(meal);
  const res = rebalanceDay(DAY.meals, DAY.eaten);
  DAY.note = treatNote(res, 'הפינוק הוסר וההמשך עודכן ✓');
  DAY.warn.menu = res.partialWarn || null;
  saveDay();
  renderDay();
}

// ══════════════════════════════════════════
//  "אכלתי משהו אחר" — דיווח אכילה חריגה ובנייה מחדש של המשך היום
// ══════════════════════════════════════════
let altIdx = null;
let altCart = [];   // הפריטים שנאכלו בפועל — אפשר כמה (שווארמה + קולה...)

function altFoodRows(query) {
  const q = (query || '').trim();
  return ALL.filter(f => !q || f.name.includes(q)).map(f =>
    `<div class="picker-item" role="button" tabindex="0" onclick="altFood(${f.id})">
      <span>${esc(f.name)} <small>(${f.unitG ? esc(f.unitLabel || f.unitG + 'g') : '100g'})</small></span>
      <span class="picker-cal">${Math.round(f.cal * (f.unitG || 100) / 100)} קק"ל</span>
    </div>`).join('') || `<div class="picker-sub">לא נמצא — נסה את הטאב הידני</div>`;
}

function openAltPicker(mi) {
  closeAltPicker();
  altIdx = mi;
  altCart = [];
  const ov = document.createElement('div');
  ov.className = 'picker-overlay';
  ov.id = 'alt-picker';
  ov.innerHTML = `<div class="picker-box">
    <div class="picker-title">מה אכלת בפועל? 🔄</div>
    <div class="picker-sub">הוסף פריט אחד או יותר — ונבנה מחדש את המשך היום סביבם</div>
    <div class="picker-tabs">
      <button class="ptab active" onclick="altTab(this, 'alt-treats')">פינוקים</button>
      <button class="ptab" onclick="altTab(this, 'alt-foods')">מהמאגר</button>
      <button class="ptab" onclick="altTab(this, 'alt-manual')">ידני</button>
    </div>
    <div id="alt-treats" class="picker-list">` + TREATS.map(tr =>
      `<div class="picker-item" role="button" tabindex="0" onclick="altFood(${tr.id})">
        <span>${esc(tr.name)} <small>(${esc(tr.unitLabel)})</small></span>
        <span class="picker-cal">${Math.round(tr.cal * tr.unitG / 100)} קק"ל</span>
      </div>`).join('') + `</div>
    <div id="alt-foods" class="picker-pane" style="display:none">
      <input id="alt-search" class="picker-input" placeholder="חיפוש מאכל..." oninput="document.getElementById('alt-food-list').innerHTML = altFoodRows(this.value)">
      <input id="alt-grams" class="picker-input" type="number" min="1" inputmode="numeric" placeholder="כמות בגרמים (ריק = מנה רגילה)">
      <button class="btn-secondary" style="width:100%;margin-bottom:8px" onclick="altFoodTop()">➕ הוסף את המאכל</button>
      <div class="picker-sub" style="margin-bottom:6px">או בחר/י ישירות מהרשימה:</div>
      <div id="alt-food-list" class="picker-list">${altFoodRows('')}</div>
    </div>
    <div id="alt-manual" class="picker-pane" style="display:none">
      <input id="alt-name" class="picker-input" placeholder="מה אכלת? (למשל: בורקס)">
      <input id="alt-cal" class="picker-input" type="number" min="0" placeholder="כמה קלוריות בערך?">
      <button class="btn-secondary" style="width:100%" onclick="altManual()">+ הוסף לרשימה</button>
      <div class="picker-sub" style="margin-top:8px">לא בטוח? הערכה גסה מספיקה.</div>
    </div>
    <div id="alt-cart" class="alt-cart"></div>
    <button id="alt-apply" class="btn-primary picker-cancel" style="display:none" onclick="applyAltCart()"></button>
    <button class="btn-secondary picker-cancel" onclick="closeAltPicker()">ביטול</button>
  </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeAltPicker(); });
  document.body.appendChild(ov);
}

function altTab(btn, paneId) {
  document.querySelectorAll('#alt-picker .ptab').forEach(b => b.classList.toggle('active', b === btn));
  ['alt-treats', 'alt-foods', 'alt-manual'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === paneId ? '' : 'none';
  });
}

function closeAltPicker() {
  const el = document.getElementById('alt-picker');
  if (el) el.remove();
  altIdx = null;
  altCart = [];
}

function renderAltCart() {
  const box = document.getElementById('alt-cart');
  const apply = document.getElementById('alt-apply');
  if (!box || !apply) return;
  if (!altCart.length) {
    box.innerHTML = '';
    apply.style.display = 'none';
    return;
  }
  const total = altCart.reduce((s, it) => s + it.cal, 0);
  box.innerHTML = altCart.map((it, i) =>
    `<div class="alt-cart-row">
      <span>${esc(it.displayName || it.f.name)}${it.dispG ? ` <small>(${esc(it.dispG)})</small>` : ''}</span>
      <span>${it.cal} קק"ל <button class="cart-x" onclick="removeAltItem(${i})">✕</button></span>
    </div>`).join('') +
    `<div class="alt-cart-row alt-cart-total"><span>סה"כ</span><span>${total} קק"ל</span></div>`;
  apply.style.display = '';
  apply.textContent = `עדכן ובנה מחדש את ההמשך (${altCart.length})`;
}

function removeAltItem(i) {
  altCart.splice(i, 1);
  renderAltCart();
}

function altFood(id) {
  const f = FOOD_BY_ID[id];
  if (!f) return;
  const gIn = document.getElementById('alt-grams');
  const g = (gIn && parseInt(gIn.value)) || f.unitG || 100;
  altCart.push(mkItem(f, g));
  renderAltCart();
}

// הוספת המאכל המבוקש לפי החיפוש + הגרמים, בלי צורך להגיע לרשימה (חשוב במובייל כשהמקלדת פתוחה)
function altFoodTop() {
  const q = (document.getElementById('alt-search')?.value || '').trim();
  const f = ALL.find(x => allowed(x) && (!q || x.name.includes(q)));
  if (f) altFood(f.id);
}

// ── הוספת פריט לארוחה (מצב עריכה) — מוסיף ל-DAY.meals[mi] בלי לבנות מחדש (פילוסופיית "skip") ──
let addItemMi = null;
let aiSelId   = null;   // המאכל שנבחר. לחיצה על שורה *בוחרת* ולא מוסיפה.

function aiRows(query) {
  const q = (query || '').trim();
  return ALL.filter(f => allowed(f) && (!q || f.name.includes(q))).slice(0, 80).map(f =>
    `<div class="picker-item${f.id === aiSelId ? ' sel' : ''}" role="button" tabindex="0" onclick="aiSelect(${f.id})">
      <span>${esc(f.name)} <small>(${f.unitG ? esc(f.unitLabel || f.unitG + 'g') : '100g'})</small></span>
      <span class="picker-cal">${Math.round(f.cal * (f.unitG || 100) / 100)} קק"ל</span>
    </div>`).join('') || `<div class="picker-sub">לא נמצא מאכל</div>`;
}

// בחירה בלבד. ההוספה קורית רק בלחיצה על "הוסף לארוחה", כדי שלא ייכנסו פריטים
// בטעות ושתהיה הזדמנות לקבוע כמות לפני שמשהו קורה.
function aiSelect(id) {
  aiSelId = id;
  const list = document.getElementById('ai-list');
  if (list) list.innerHTML = aiRows(document.getElementById('ai-search')?.value || '');
  aiSyncQty();
  aiFeedback('');
}

// שתי שורות כמות, ורק הרלוונטית מוצגת: מאכל שנספר ביחידות מקבל שדה יחידות
// *וגם* שדה גרם למי שמעדיפה לשקול; מאכל שנמכר במשקל מקבל גרם בלבד.
function aiSyncQty() {
  const f = aiSelId ? FOOD_BY_ID[aiSelId] : null;
  const box  = document.getElementById('ai-qty');
  const head = document.getElementById('ai-chosen');
  const uWrap = document.getElementById('ai-units-wrap');
  const btn  = document.getElementById('ai-add-btn');
  if (!box || !head || !btn) return;
  if (!f) {
    box.style.display = 'none';
    head.textContent = '';
    btn.disabled = true;
    return;
  }
  box.style.display = '';
  btn.disabled = false;
  head.textContent = 'נבחר: ' + f.name +
    (f.unitG ? '  ·  ' + (f.unitLabel || 'יחידה') + ' = ' + f.unitG + ' גרם' : '');
  if (uWrap) uWrap.style.display = f.unitG ? '' : 'none';
}
function openAddItemPicker(mi) {
  closeAddItemPicker();
  addItemMi = mi;
  aiSelId = null;
  const ov = document.createElement('div');
  ov.className = 'picker-overlay'; ov.id = 'add-item-picker';
  ov.innerHTML = `<div class="picker-box">
    <div class="picker-title">הוספת פריט לארוחה ➕</div>
    <div class="picker-sub">בוחרים מאכל מהרשימה, קובעים כמות, ומוסיפים</div>
    <input id="ai-search" class="picker-input" placeholder="חיפוש מאכל..." oninput="document.getElementById('ai-list').innerHTML = aiRows(this.value)">
    <div id="ai-list" class="picker-list">${aiRows('')}</div>
    <div id="ai-chosen" class="ai-chosen"></div>
    <div id="ai-qty" class="ai-qty" style="display:none">
      <label id="ai-units-wrap"><span>כמות ביחידות</span>
        <input id="ai-units" class="picker-input" type="number" min="1" inputmode="numeric" placeholder="למשל 3"></label>
      <label><span>או במשקל (גרם)</span>
        <input id="ai-grams" class="picker-input" type="number" min="1" inputmode="numeric" placeholder="למשל 150"></label>
    </div>
    <button id="ai-add-btn" class="btn-secondary" style="width:100%;margin-bottom:8px" onclick="aiAddSelected()" disabled>➕ הוסף לארוחה</button>
    <div id="ai-feedback" class="ai-feedback"></div>
    <button class="btn-primary picker-cancel" onclick="closeAddItemPicker()">סיום</button>
  </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeAddItemPicker(); });
  document.body.appendChild(ov);
}
function closeAddItemPicker() {
  const el = document.getElementById('add-item-picker');
  if (el) el.remove();
  addItemMi = null;
  aiSelId = null;
}
function aiAddSelected() {
  if (!aiSelId) { aiFeedback('בחרו מאכל מהרשימה', true); return; }
  aiAdd(aiSelId);
}

// משוב אחרי הוספה. בלעדיו החלון נראה זהה לפני ואחרי, המשתמשת מניחה שהלחיצה
// לא נקלטה ולוחצת שוב — וזה בדיוק המקור ל"פתאום נוספות 2".
function aiFeedback(msg, isErr) {
  const el = document.getElementById('ai-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ai-feedback' + (isErr ? ' err' : ' ok');
}
function aiAdd(id) {
  if (!DAY || addItemMi == null) return;
  const f = FOOD_BY_ID[id]; if (!f) return;
  const mi = addItemMi;
  // שני שדות נפרדים במקום אחד דו-משמעי: יחידות למי שחושבת "3 פריכיות",
  // גרם למי שמעדיפה לשקול. שדה אחד שמתפרש לפי סוג המאכל היה מבלבל, ומשתמשת
  // שרצתה 3 קיבלה 4 כי המספר נקרא כגרמים. (דווח 08/08/2026)
  const uIn = document.getElementById('ai-units');
  const gIn = document.getElementById('ai-grams');
  const rawU = uIn ? parseFloat(uIn.value) : NaN;
  const rawG = gIn ? parseFloat(gIn.value) : NaN;
  const wantUnits = (f.unitG && rawU > 0) ? Math.max(1, Math.round(rawU)) : null;
  const g = wantUnits ? wantUnits * f.unitG
          : rawG > 0  ? rawG
          : (f.unitG || 100);
  const m = DAY.meals[mi]; if (!m) return;
  const it = mkItem(f, g);

  // רצפות הכמות במחולל (למשל 16g פריכיות = 4 יחידות דקות) נועדו למנוע מנות
  // מגוחכות בתפריט *שנבנה אוטומטית*. הן לא אמורות לדרוס בקשה מפורשת: משתמשת
  // שביקשה 3 פריכיות דקות קיבלה 4 בלי שהתכוונה. תקרת הריאליזם נשמרת (צלחת
  // אמיתית), אבל כלפי מטה הבחירה שלה קובעת. (דווח 08/08/2026)
  if (wantUnits && f.unitG) {
    const got = Math.round(it.g / f.unitG);
    if (got > wantUnits) {
      const exact = wantUnits * f.unitG;
      it.g = exact;
      it.dispG = f.tags.includes('cracker') ? `${wantUnits} פריכיות (${exact}g)`
               : wantUnits === 1 ? (f.unitLabel || `${exact}g`)
               : `${wantUnits} ${f.plural || 'יחידות'}`;
      setMacros(it, f, exact);
    }
  }

  m.items.push(it); m.removed = false;
  m.edited = true;   // מנעול, כמו בהסרה
  recalcMeal(m); saveDay();
  DAY.note = 'הפריט נוסף לארוחה ✓ שאר היום לא השתנה.';
  checkDayLevel();                 // הוספה יכולה גם להחזיר את היום לטווח
  editingMeals.add(mi);            // הארוחה נשארת פתוחה לעריכה גם אחרי הרינדור מחדש
  renderDay();                     // חלון ההוספה על ה-body ולכן נשאר פתוח
  addItemMi = mi;
  if (uIn) uIn.value = '';         // כדי שהכמות מהוספה קודמת לא תידבק לפריט הבא
  if (gIn) gIn.value = '';

  // אם תקרת הריאליזם חתכה את הכמות — אומרים את זה. חיתוך שקט הוא מה שגרם
  // למשתמשת לחשוב שהמוצר שבור, כי היא ביקשה 3 וקיבלה 4 בלי הסבר.
  // ⚠️ בלי ספירת פריטים בהודעה: היא בלבלה יותר משעזרה (דווח 08/08/2026).
  const gotUnits = f.unitG ? Math.round(it.g / f.unitG) : null;
  if (wantUnits && gotUnits && gotUnits !== wantUnits) {
    // רק חיתוך כלפי מעלה נשאר אפשרי, וההודעה אומרת את הכיוון הנכון
    aiFeedback('נוסף ' + gotUnits + ' במקום ' + wantUnits + ', זו הכמות המרבית לארוחה אחת', true);
  } else {
    aiFeedback('נוסף: ' + f.name + (it.dispG ? ' · ' + it.dispG : '') + ' ✓');
  }
}

function altManual() {
  const nameEl = document.getElementById('alt-name');
  const calEl = document.getElementById('alt-cal');
  const name = (nameEl.value || '').trim() || 'ארוחה מחוץ לתפריט';
  const cal = parseFloat(calEl.value);
  if (isNaN(cal) || cal < 0) { alert('יש להזין הערכת קלוריות'); return; }
  altCart.push(manualItem(name, cal));
  nameEl.value = ''; calEl.value = '';
  renderAltCart();
}

function applyAltCart() {
  if (!altCart.length || altIdx === null || !DAY) return;
  const mi = altIdx;
  const items = altCart.slice();
  closeAltPicker();
  const res = rebuildRest(DAY.meals, DAY.eaten, mi, items);
  DAY.note = res.note;
  DAY.warn.menu = res.partialWarn || null;
  saveDay();
  renderDay();
}

// ══════════════════════════════════════════
//  חלון ויתור
// ══════════════════════════════════════════
function closeDisclaimer() {
  const ack = document.getElementById('disclaimer-ack');
  if (ack && !ack.checked) return;   // הצהרה אקטיבית — לא סוגרים בלי אישור
  document.getElementById('disclaimer-overlay').style.display = 'none';
  document.getElementById('age')?.focus();   // נגישות: מחזירים פוקוס לתוכן אחרי סגירת המודאל
}

// ── הדפסה/PDF בעמוד אחד: מכווצים את התפריט כך שייכנס לדף A4 יחיד (כל מספר ארוחות) ──
// מודדים את גובה התוכן כשהכרום מוסתר (אותה רשימת סלקטורים כמו ב-@media print ב-style.css)
// ומחשבים zoom שמתאים לעמוד. beforeprint חל גם על window.print() מהכפתור.
const PRINT_HIDE_SEL = '.step-bar,.disclaimer-overlay,.nav-btns,.treat-bar,.day-progress,' +
  '.eaten-btn,.alt-btn,.meal-edit-btn,.item-remove,.treat-remove,.coach-cta,.site-footer,' +
  '.macro-row,.food-thumb,.tips-box,.treat-tip,.day-note';
function fitMenuToOnePage() {
  const wrap = document.querySelector('.app-wrapper');
  if (!wrap) return;
  wrap.style.zoom = '';
  const s = document.createElement('style');
  s.textContent = PRINT_HIDE_SEL + '{display:none!important} .app-wrapper{min-height:auto!important;padding:4px 10px!important}';
  document.head.appendChild(s);
  const contentH = wrap.scrollHeight;     // גובה התוכן כפי שיודפס (כרום מוסתר)
  s.remove();
  const pageH = (297 - 20) * 96 / 25.4 * 0.96;   // A4 פחות שולי 10מ"מ, עם ~4% מרווח ביטחון
  if (contentH > pageH) wrap.style.zoom = String(Math.max(0.6, +(pageH / contentH).toFixed(3)));
}
window.addEventListener('beforeprint', fitMenuToOnePage);
window.addEventListener('afterprint', () => { const w = document.querySelector('.app-wrapper'); if (w) w.style.zoom = ''; });

// ══════════════════════════════════════════
//  לייטבוקס לתמונות מוצר
// ══════════════════════════════════════════
// במגע (מובייל) אין hover אמיתי — ההגדלה הקודמת (CSS :hover בלבד) נתקעה בלי דרך לסגור.
// כאן נגיעה/קליק על תמונה פותחת שכבת-על, ונגיעה בכל מקום / ✕ / Escape סוגרת. ה-hover בדסקטופ נשאר.
let _imgLb = null, _imgLbPrevFocus = null;
function _imgLbKey(e) { if (e.key === 'Escape') closeImgLightbox(); }
function closeImgLightbox() {
  if (!_imgLb || _imgLb.style.display === 'none') return;
  _imgLb.style.display = 'none';
  document.removeEventListener('keydown', _imgLbKey);
  if (_imgLbPrevFocus && _imgLbPrevFocus.focus) { try { _imgLbPrevFocus.focus(); } catch (e) {} }
  _imgLbPrevFocus = null;
}
function openImgLightbox(src, alt) {
  if (!_imgLb) {
    _imgLb = document.createElement('div');
    _imgLb.className = 'img-lightbox';
    _imgLb.setAttribute('role', 'dialog');
    _imgLb.setAttribute('aria-modal', 'true');
    _imgLb.innerHTML = '<button type="button" class="img-lightbox-close" aria-label="סגירה">✕</button><img alt="">';
    _imgLb.addEventListener('click', closeImgLightbox);   // נגיעה בכל מקום (רקע/תמונה/✕) סוגרת
    document.body.appendChild(_imgLb);
  }
  const img = _imgLb.querySelector('img');
  img.src = src; img.alt = alt || '';                     // מאפייני DOM — לא הזרקת HTML
  _imgLb.setAttribute('aria-label', alt || 'תמונת מאכל');
  _imgLbPrevFocus = document.activeElement;
  _imgLb.style.display = 'flex';
  document.addEventListener('keydown', _imgLbKey);
  _imgLb.querySelector('.img-lightbox-close').focus();
}
// מאזין מואצל אחד על document — תופס גם את מסך התפריט וגם את מודאל ההיסטוריה (readOnly)
document.addEventListener('click', e => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.closest && img.closest('.food-thumb')) {
    e.preventDefault();
    openImgLightbox(img.src, img.alt);
  }
});

// ══════════════════════════════════════════
//  איפוס מלא לתפריט חדש
// ══════════════════════════════════════════
function resetApp() {
  S.liked.clear();
  S.avoided.clear();
  S.diet.clear();
  S.allergy.clear();
  S.time   = null;
  S.noTrain = false;
  S.goal   = 'maintain';
  S.treats = [];

  document.querySelectorAll('.chip').forEach(el => el.classList.remove('active', 'active-danger'));
  ['cut','maintain','bulk'].forEach(x => document.getElementById(x + '-btn').classList.remove('active'));
  document.getElementById('maintain-btn').classList.add('active');
  document.querySelectorAll('.time-card').forEach(c => c.classList.remove('active'));
  const noTrainBtn = document.getElementById('notrain-btn');
  noTrainBtn.textContent   = noTrainLabel();
  noTrainBtn.style.borderStyle = 'dashed';
  document.getElementById('time-note').style.display = 'none';
  document.getElementById('like-count').textContent  = '0';
  document.getElementById('avoid-count').textContent = '0';
  try { localStorage.removeItem(STATE_KEY); } catch (e) {}
  clearDay();

  goTo(0);
}
