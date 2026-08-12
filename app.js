// ══════════════════════════════════════════
//  app.js — לוגיקה ואלגוריתם
//  גרסה 1.0 | Diet Application
// ══════════════════════════════════════════

// ── מצב האפליקציה ──
const S = {
  gender: 'male',
  goal: 'maintain',
  age: 28, height: 178, weight: 80,
  diet: new Set(),       // kosher | vegan | vegetarian | gluten_free | lactose_free | supplements
  allergy: new Set(),    // nuts | peanuts | eggs | fish | soy | sesame
  time: null,            // morning | noon | evening | null
  noTrain: false,
  liked: new Set(),      // IDs של מאכלים מועדפים
  avoided: new Set(),    // IDs של מאכלים מוחרגים
  // ערכי מאקרו מחושבים
  bmr: 0, rmr: 0, target: 0, proteinG: 0, fatG: 0, carbG: 0, fibG: 0,
  bmiWarning: null,
  trainWarning: null,    // מסה בלי אימון — עודף קלורי בלי אימוני כוח
  carbWarning: null,
  menuWarning: null,    // מוצג כשאי אפשר לעמוד ביעד עם ההעדפות (גלישה קלורית בלתי-פתירה)
  calFloorWarning: null,// היעד הועלה לרצפה הקלורית הבריאה
  treats: [],           // ids מתוך TREATS — פינוקים מתוכננים שהתפריט נבנה סביבם
};

// ── ALL foods flat array (מאוחד מ-DB) ──
const ALL = Object.values(DB).flat();

// ── טונה: סוג אחד בלבד לתפריט, מקסימום קופסה אחת ──
const TUNA_IDS = new Set(ALL.filter(f => f.tags.includes('tuna')).map(f => f.id));
const tunaUsed = used => [...TUNA_IDS].some(id => used.has(id));

// ── תקרת מנת דגן-בגרמים, תלוית-מטרה: במסה (משקל/יעד גבוה) מנות גדולות הגיוניות, בחיטוב לא.
// שיבולת שועל (תג breakfast) מקבלת תקרה הדוקה יותר — ארוחת בוקר, לא מאגר הקלוריות של היום.
const isElasticGrain = f => f && !f.unitLabel && (f.tags.includes('hot_carb') || f.tags.includes('grain'));
// ארוחה חמה יחידה ביום (בוקר/ללא-אימון) — שם הדגן הבודד הוא מנוף הקלוריות העיקרי. צהריים/ערב = 2 ארוחות חמות.
const singleHotMeal = () => S.noTrain || (S.time !== 'noon' && S.time !== 'evening');
const grainCap = f => f.tags.includes('breakfast')
  ? ({ cut: 280, maintain: 300, bulk: 350 }[S.goal] || 350)   // שיבולת שועל — ארוחת בוקר, תקרה הדוקה
  : singleHotMeal()
    ? ({ cut: 320, maintain: 480, bulk: 600 }[S.goal] || 480)   // ארוחה חמה יחידה — תקרה גבוהה (הפיצול שומר על מנות ריאליסטיות); נחוץ לסגירת היעד
    : ({ cut: 280, maintain: 350, bulk: 450 }[S.goal] || 450);  // רב-ארוחות-חמות (צהריים/ערב) — תקרה רגילה, ללא שינוי
// רצפת מנת-חלבון מרכזית (בשר/דג בארוחה חמה) — מנה ריאליסטית, לא 30g. goal-aware, ניתן לכיול.
const mainProtFloor = () => ({ cut: 70, maintain: 85, bulk: 90 }[S.goal] || 85);
// תקרת הגשה למנה המרכזית — צלחת ריאלית (לא 350g בשר): כשמגיעים לתקרה, יתרת החלבון
// מושלמת דרך שאר המנופים / הזרקת מנת חלבון קלה (protein top-up ב-reconcile).
const mainProtCap = () => ({ cut: 250, maintain: 280, bulk: 320 }[S.goal] || 280);
// קטניות שאינן מטבל — לזיהוי "כבר יש תוספת קטנייה היום" (מגבילים לאחת: הן מנוף חלבון, לא פחמימה,
// ויום שכולו תוספות-קטנייה נשאר בלי מנוף קלוריות גמיש ונתקע עמוק מתחת ליעד)
const LEGUME_SIDE_IDS = new Set(ALL.filter(f => f.tags.includes('legume') && !f.dip).map(f => f.id));

// ── קבוצות וריאנטים: אחד מכל קבוצה לתפריט — נאכף בסינון של pick ──
// קוטג' 3%/5% (לא שניהם); ביצים M/L/XL (חביתה אחת ביום — מזהים שונים ולכן used לא תופס לבד)
const VARIANT_GROUPS = [[20, 21], [15, 16, 17], [45, 46, 100]];   // קוטג' / ביצים / פריכיות — סוג אחד מכל קבוצה לתפריט
const variantBlocked = (f, used) =>
  VARIANT_GROUPS.some(g => g.includes(f.id) && g.some(id => id !== f.id && used.has(id)));

// ערבוב (Fisher-Yates) — לגיוון בחירת מאכלים מועדפים
const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// ══════════════════════════════════════════
//  חישובי מאקרו — Harris-Benedict 1919 × 1.2
// ══════════════════════════════════════════
function calcMacro() {
  const bmr = S.gender === 'male'
    ? 66.5 + 13.75 * S.weight + 5.003 * S.height - 6.755 * S.age
    : 655.1 + 9.563 * S.weight + 1.85  * S.height - 4.676 * S.age;

  S.bmr = Math.round(bmr);

  // גורם פעילות אסימטרי לפי יעד: חיטוב/לא-מתאמן/טרם-נבחר-זמן-אימון שמרני (1.2 — מגן על הגירעון);
  // שמירה/מסה של מתאמן — פעילות קלה (1.375) כדי שהתחזוקה מדויקת והעודף במסה אמיתי.
  // !S.time => מסך 0 (לפני בחירת אימון) מציג בסיס יושבני; בחירת זמן אימון מעלה ל-1.375 (תמיד כלפי מעלה,
  // אף פעם לא "לוקחים" קלוריות שהוצגו), ו"לא מתאמן" נשאר 1.2 בדיוק כפי שהוצג. מיושר עם mealPlan.
  const af = (S.noTrain || !S.time || S.goal === 'cut') ? 1.2 : 1.375;
  S.rmr = Math.round(bmr * af);

  const cutDeficit = Math.min(500, Math.round(S.rmr * 0.20));
  S.target = S.goal === 'cut'  ? S.rmr - cutDeficit
           : S.goal === 'bulk' ? S.rmr + 300
           :                     S.rmr;

  // רצפה קלורית בטיחותית — הערת שקיפות כשהיא מעלה את היעד
  const floor = S.gender === 'female' ? 1200 : 1500;
  if (S.target < floor) {
    S.target = floor;
    S.calFloorWarning = 'היעד הועלה למינימום הקלורי הבריא המומלץ. לא מומלץ לרדת מתחתיו.';
  } else {
    S.calFloorWarning = null;
  }

  // חלבון — לפי BMI (פרוקסי גוף-רזה ל-BMI≥30). מתאמן 2g/ק"ג; טבעוני או ללא אימון 1.6.
  const bmi = S.weight / (S.height / 100) ** 2;
  const pw  = bmi >= 30 ? 25 * (S.height / 100) ** 2 : S.weight;
  const pf  = (S.diet.has('vegan') || S.noTrain) ? 1.6 : 2;
  S.protRefW = Math.min(S.weight, pw);   // משקל הייחוס לחלבון — מקור אמת יחיד (גם לרצפת הקיצוץ ב-reconcile)
  S.proteinG = Math.round(S.protRefW * pf);
  S.fatG     = Math.max(S.gender === 'female' ? 40 : 25,
                        Math.round(S.target * 0.25 / 9));   // 25% מהקלוריות (WHO ≤30%; 20% היה הקצה התחתון — משוב מקצועי 12/07). רצפות גרמים נשמרות.
  const macroFloor = S.proteinG * 4 + S.fatG * 9 + 100 * 4;
  if (S.target < macroFloor) {
    S.target = macroFloor;
    S.carbWarning = 'הגירעון הקלורי צומצם מעט כדי לעמוד במינימום המומלץ של חלבון, שומן ופחמימות.';
  } else {
    S.carbWarning = null;
  }
  S.carbG = Math.round((S.target - S.proteinG * 4 - S.fatG * 9) / 4);
  S.fibG  = Math.round(S.target * 14 / 1000);   // רצפת סיבים (IOM): 14 ג' לכל 1000 קק"ל
}

// ══════════════════════════════════════════
//  בדיקת התאמה לפי העדפות ואלרגיות
// ══════════════════════════════════════════
function allowed(f) {
  if (S.avoided.has(f.id)) return false;
  const a = S.allergy, d = S.diet;
  if (a.has('eggs')    && (f.tags.includes('egg') || f.containsEgg))   return false;   // ביצה מפורשת + מאכלים עם ציפוי/ביצה (שניצל)
  if (a.has('fish')    && f.tags.includes('fish'))       return false;
  if (a.has('nuts')    && (f.tags.includes('nuts') || f.containsNuts)) return false;   // אגוזים מפורשים + מאכלים שעלולים להכיל (גרנולה/חטיף אנרגיה)
  if (a.has('peanuts') && f.tags.includes('peanuts'))    return false;
  if (a.has('soy')     && f.tags.includes('soy'))        return false;
  if (a.has('sesame')  && f.tags.includes('sesame'))     return false;
  if (d.has('vegan')   && (f.tags.includes('meat') || f.tags.includes('fish') ||
                            f.tags.includes('dairy')|| f.tags.includes('egg'))) return false;
  if (d.has('vegan')   && f.id === 111) return false;   // דבש אינו טבעוני (סילן כן)
  if (d.has('vegetarian') && (f.tags.includes('meat') || f.tags.includes('fish'))) return false;
  if (d.has('lactose_free') && f.tags.includes('dairy')) return false;
  if (d.has('gluten_free') && f.tags.includes('gluten')) return false;   // ללא גלוטן — מחריג חיטה/שיפון/שיבולת שועל וכו'
  if (f.gfOnly && !d.has('gluten_free')) return false;   // פריטים ייעודיים ללא גלוטן — רק למשתמשי GF
  if (f.tags.includes('supplement') && !d.has('supplements')) return false;
  if (f.vegOnly && !d.has('vegan') && !d.has('vegetarian')) return false;
  if (f.containsMilk && (d.has('vegan') || d.has('lactose_free'))) return false;
  if (f.optIn && !S.liked.has(f.id)) return false;   // מאכלים נישתיים — רק אם סומנו במפורש
  return true;
}

// ══════════════════════════════════════════
//  כמויות חכמות
// ══════════════════════════════════════════
function eggDisplay(g, unitW, size) {
  const n = Math.max(1, Math.min(2, Math.round(g / unitW)));
  const base = n === 1 ? 'חביתה מביצה אחת' : 'חביתה משתי ביצים';
  return { label: size ? `${base} (${size})` : base, g: n * unitW };
}

function cottagePortion(targetG) {
  return targetG >= 200
    ? { g: 250, dispG: 'קופסה (250g)' }
    : { g: 125, dispG: 'חצי קופסה (125g)' };
}

// תקרת פריכיות לארוחה — בגרמים ולא ביחידות: פריכייה דקה (4g) אינה פריכייה גדולה (9g),
// וספירה עיוורת הרעיבה ארוחות (4 דקות = 16g בלבד). חיטוב/שמירה ~36g, בולק ~54g; 2–12 יחידות.
const crackerMaxN = unitW => Math.max(2, Math.min(12, Math.round((S.goal === 'bulk' ? 54 : 36) / (unitW || 9))));
// מינימום פריכיות גם הוא בגרמים (~16g): "2 פריכיות דקות (8g)" זו פחמימה סמלית, לא מנה
const crackerMinN = unitW => Math.max(2, Math.round(16 / (unitW || 9)));
function crackerPortion(targetG, unitW) {
  const n = Math.max(crackerMinN(unitW), Math.min(crackerMaxN(unitW), Math.round(targetG / unitW)));
  return { g: n * unitW, dispG: `${n} פריכיות (${n * unitW}g)` };
}

// קובע cal/p/c/fat/fib על פריט לפי המזון f וכמות g (ערכי המזון תמיד ל-100g). משמש בכל מקום
// שבונה/מעדכן כמות — מונע שכפול של נוסחת המאקרו.
function setMacros(it, f, g) {
  it.cal = Math.round(f.cal * g / 100);
  it.p   = Math.round(f.p   * g / 10) / 10;
  it.c   = Math.round(f.c   * g / 10) / 10;
  it.fat = Math.round(f.f   * g / 100);
  it.fib = Math.round((f.fib || 0) * g / 10) / 10;
  return it;
}

function mkItem(f, g) {
  let dispG, displayName;
  if (f.isEgg) {
    const size = f.name.startsWith('ביצה ') ? f.name.replace('ביצה ', '') : null;
    const e = eggDisplay(g, f.unitG || 63, size); g = e.g;
    displayName = e.label;   // "חביתה מביצה אחת" / "חביתה משתי ביצים"
    dispG = '';
  } else if ((f.id === 20 || f.id === 21) && f.halfLabel) {
    const c = cottagePortion(g); g = c.g; dispG = c.dispG;
  } else if (f.tags.includes('cracker')) {
    const c = crackerPortion(g, f.unitG || 9); g = c.g; dispG = c.dispG;
  } else if (f.plural && f.unitG) {
    // פריט יחידות (פרי/לחם/עמילני/גביע) — מצמידים ליחידות שלמות והתווית אומרת אמת:
    // "תמר אחד" לא יסתיר 72g, "גביע (170g)" לא יסתיר 250g
    let n = Math.max(1, Math.round(g / f.unitG));
    if (f.tags.includes('bread') && !f.tags.includes('cracker'))
      n = Math.min(n, f.pita ? 1 : 2);   // ריאליזם: עד 2 פרוסות לחם / פיתה אחת לארוחה
    else if (f.tags.includes('fruit'))
      n = Math.min(n, Math.max(1, Math.floor(200 / f.unitG)));   // ריאליזם: עד ~200g פרי לארוחה (קלמנטינה→2, בננה/תפוח→1, תמרים קטנים→נשארים סבירים)
    g = n * f.unitG;
    dispG = n === 1 ? f.unitLabel : `${n} ${f.plural}`;
  } else if (f.unitLabel) {
    dispG = f.unitLabel;
  } else {
    dispG = `${g}g`;
  }
  return setMacros({ f, g, dispG, displayName }, f, g);
}

// ══════════════════════════════════════════
//  בחירת מזון — מועדפים ראשונה, ללא חזרות
// ══════════════════════════════════════════
function pick(pool, used, calT, protT, maxG) {
  // מועדפים ראשונים, אחריהם השאר — שתי הקבוצות בסדר אקראי לגיוון
  const ok = f => allowed(f) && !used.has(f.id) && !variantBlocked(f, used);
  const sorted = [
    ...shuffle(pool.filter(f => S.liked.has(f.id) && ok(f))),
    ...shuffle(pool.filter(f => !S.liked.has(f.id) && ok(f))),
  ];
  for (const f of sorted) {
    let lim = maxG, hard = Infinity;   // hard = תקרה קשיחה (maxDay/maxMeal); maxG הוא רק יעד גודל רך
    if (f.maxDay) { const a = used.get(f.id) || 0; hard = Math.min(hard, f.maxDay - a); }
    if (f.maxMeal) hard = Math.min(hard, f.maxMeal);
    if (isElasticGrain(f)) hard = Math.min(hard, grainCap(f));   // תקרת מנת דגן תלוית-מטרה
    lim = Math.min(lim, hard);
    if (lim < 20 || hard < (f.unitG || 40)) continue;   // אין מקום למנת מינימום — רצפת ה-clamp הייתה חורגת מהתקרה הקשיחה
    let g = protT > 0 && f.p > 0
      ? Math.round(protT / f.p * 100)
      : Math.round(calT / f.cal * 100);
    if (f.unitG && !f.isEgg && !f.tags.includes('cracker') && f.id !== 20 && f.id !== 21)
      g = Math.round(g / f.unitG) * f.unitG;
    g = Math.max(f.unitG || 40, Math.min(g, lim));
    // אחרי ה-clamp מיישרים שוב ליחידות שלמות (כלפי מטה) — שהתווית לא תשקר
    // (אבטיח 250g עם תווית "פרוסה (200g)": ה-clamp ל-lim שבר את יישור היחידות)
    if (f.unitG && !f.isEgg && !f.tags.includes('cracker') && f.id !== 20 && f.id !== 21)
      g = Math.max(f.unitG, Math.floor(g / f.unitG) * f.unitG);
    return mkItem(f, g);
  }
  return null;
}

function use(used, item) {
  if (item) used.set(item.f.id, (used.get(item.f.id) || 0) + item.g);
}

// ══════════════════════════════════════════
//  בניית סלט מאוגד (מינימום 2 ירקות רגילים + שמן זית)
// ══════════════════════════════════════════
// חישוב-מחדש של קבוצת סלט מתוך הרכיבים הגולמיים (_comps) וכמות השמן (_oilG).
// מאפשר ל-reconcile לכוונן את השמן (מנוף שומן חלק) ולעדכן את התצוגה והמאקרו.
function recalcSalad(sg) {
  const comps = sg._comps, oil = sg._oil, oilG = sg._oilG || 0;
  const fmtPart = (f, g) => {
    if (f.plural && f.unitG) {   // יחידות שלמות (זיתים) — "6 זיתים", לא "זית אחד" המסתיר 30g
      const n = Math.max(1, Math.round(g / f.unitG));
      return n === 1 ? f.unitLabel : `${n} ${f.plural}`;
    }
    return f.unitLabel || `${g}g`;
  };
  const parts = comps.map(c => fmtPart(c.f, c.g));
  if (oil && oilG > 0) parts.push(oilG === 5 ? 'כפית שמן זית' : `${oilG / 5} כפיות שמן זית`);
  sg.parts = parts;
  const sum = sel => comps.reduce((a, c) => a + (c.f[sel] || 0) * c.g / 100, 0);
  sg.cal = Math.round(comps.reduce((a, c) => a + c.f.cal * c.g / 100, 0)) + (oil && oilG ? Math.round(oil.cal * oilG / 100) : 0);
  sg.p   = Math.round(sum('p') * 10) / 10;
  sg.c   = Math.round(sum('c') * 10) / 10;
  sg.fat = Math.round((sum('f') + (oil && oilG ? oil.f * oilG / 100 : 0)) * 10) / 10;
  sg.fib = Math.round(sum('fib') * 10) / 10;
  return sg;
}

function buildSalad(used) {
  const sortByLiked = arr => [
    ...shuffle(arr.filter(f => S.liked.has(f.id))),
    ...shuffle(arr.filter(f => !S.liked.has(f.id))),
  ];

  // ירקות רגילים (עגבנייה, מלפפון, פלפל, גזר...) — יכולים לעמוד לבד
  const regular = sortByLiked(ALL.filter(f =>
    f.tags.includes('salad') && !f.tags.includes('salad_only') &&
    allowed(f) && !used.has(f.id)
  ));
  // ירקות שמתאימים רק לסלט (חסה, כרוב, בצל)
  const extras = sortByLiked(ALL.filter(f =>
    f.tags.includes('salad_only') &&
    allowed(f) && !used.has(f.id)
  ));

  // חייבים לפחות 2 ירקות רגילים כבסיס
  if (regular.length < 2) return null;

  // רכיבי בסיס: 2 ירקות רגילים + שלישי אופציונלי (salad_only או ירק רגיל שלישי)
  const v3 = extras[0] || regular[2] || null;
  const comps = [
    { f: regular[0], g: regular[0].unitG || 120 },
    { f: regular[1], g: regular[1].unitG || 100 },
  ];
  if (v3) comps.push({ f: v3, g: v3.unitG || 80 });

  // תוספת מלוחה לסלט: אבוקדו/זיתים (אף פעם לא עם פרי!) — אם אהוב או ~30%
  const exPool = sortByLiked(ALL.filter(f => (f.id === 87 || f.id === 93) && allowed(f) && !used.has(f.id)));
  if (exPool.length && (S.liked.has(exPool[0].id) || Math.random() < 0.3))
    comps.push({ f: exPool[0], g: exPool[0].id === 93 ? 30 : (exPool[0].unitG || 50) });   // זיתים: מנת סלט ~6 יחידות

  // שמן זית — חובה בסלט (אם מותר לפי העדפות)
  const oil = ALL.find(f => f.id === 86);
  const hasOil = oil && allowed(oil);
  const oilG = hasOil ? 5 : 0;

  comps.forEach(c => use(used, c));
  if (hasOil && oil) use(used, { f: oil, g: oilG });

  // שומרים את הרכיבים הגולמיים + השמן כדי ש-reconcile יוכל לכוונן (recalcSalad)
  const sg = { isSaladGroup: true, label: 'סלט ירק',
    _comps: comps, _oil: hasOil ? oil : null, _oilG: oilG };
  return recalcSalad(sg);
}

function buildSingleVeg(used, hotOk) {
  const tag = hotOk ? 'hot_veg' : 'salad';
  const pool = ALL.filter(f =>
    f.tags.includes(tag) && allowed(f) && !used.has(f.id) && !f.tags.includes('salad_only')
  );
  const sorted = [...shuffle(pool.filter(f => S.liked.has(f.id))), ...shuffle(pool.filter(f => !S.liked.has(f.id)))];
  if (!sorted.length) return null;
  const f = sorted[0], g = f.unitG || 100;
  use(used, { f, g });
  return mkItem(f, g);
}

// ══════════════════════════════════════════
//  בניית ארוחות לפי סוג
// ══════════════════════════════════════════
// ── תבניות ארוחה (archetypes) — כל ארוחה לפי תבנית מציאותית ──
const _tag = t => f => f.tags.includes(t);
const isYogurt = f => f.id === 22 || f.id === 23 || f.id === 24;
const isCheese = f => f.id === 20 || f.id === 21 || f.id === 25 || f.id === 26; // קוטג'/לבנה/צהובה
// "חלבי" לצורך הפרדת כשרות: כל מוצר חלב + נגזרות חלב (שיבולת-בחלב 106, וויי/קזאין/בר-חלבון)
const isDairyKosher = f => f.tags.includes('dairy') || f.containsMilk;
const _sliced  = f => f.tags.includes('bread') && !f.pita; // לחם/פריכית, לא פיתה (פיתה רק עם חלבון ממולא)
// האם יש חלבון מן החי זמין למשתמש (ביצה/בשר/דג/חלב)? אם כן — קטנייה אינה ה"חלבון" בסלט
const hasAnimalProtein = () => ALL.some(f =>
  (f.tags.includes('egg') || f.tags.includes('meat') || f.tags.includes('fish') || f.tags.includes('dairy')) && allowed(f));

// ── פרופיל טעם: מתוק / מלוח / ניטרלי ────────────────────────────────────────
// התבניות בונות ארוחות קוהרנטיות, אבל פריטים שמוזרקים *אחרי* התבנית (שלב 1ב,
// עוגן חלבון, top-up) עקפו אותן לגמרי — כך יצאה דייסה עם דבש ואגס + טונה,
// וקורנפלקס בחלב + סייטן. הציר הזה הוא הבדיקה הזוגית היחידה מלבד kosherOk.
//
// הציר משולש בכוונה ולא בינארי: בינארי היה חוסם קוטג' עם פרי (תבנית dairy_fruit)
// ולחם עם פרי (bread_spread) — שילובים קיימים ומקובלים. פרי הוא ניטרלי, כי פרי
// בצד ארוחה מלוחה סביר לגמרי; לכן קבוצת ה"מתוק" קטנה, והכלל יורה רק על ארוחות
// שבנויות סביב דייסה/גרנולה/קורנפלקס — בדיוק שם שההזרקה הייתה שגויה.
const SWEET_TAGS  = ['sweet_topping', 'granola', 'cereal'];
const SAVORY_TAGS = ['meat', 'fish', 'tuna', 'veg', 'hot_veg', 'salad', 'salad_only', 'egg'];
function tasteProfile(f) {
  if (!f) return 'neutral';
  // שיבולת שועל (41 במים / 106 בחלב) מסומנת לפי id: התגית grain מכסה גם לחם,
  // שהוא ניטרלי, ולכן אי אפשר להישען עליה.
  if (f.id === 41 || f.id === 106) return 'sweet';
  if (SWEET_TAGS.some(t => f.tags.includes(t))) return 'sweet';
  if (f.tags.includes('legume') && !f.dip) return 'savory';   // חומוס/טחינה = ממרח, לא מנת קטנייה
  if (SAVORY_TAGS.some(t => f.tags.includes(t))) return 'savory';
  return 'neutral';   // חלב, לחם, פריכיות, אגוזים, תוספים, פרי
}
// ── עוגן חלבון: המנה שנתפסת כמקור החלבון של הארוחה ─────────────────────────
// ממרח/משקה/רוטב אינם עוגן (חומוס בצד, חלב לקורנפלקס), ולכן מסוננים.
// משמש כדי לא להזריק מנת חלבון שנייה לארוחה שכבר יש בה אחת — כך נמנעות
// ארוחות כמו "יוגורט יווני + טונה" או "גבינה לבנה + סייטן" (2.6% מהתפריטים לפני).
function proteinAnchor(f) {
  if (!f || f.dip || f.condiment || f.drink) return null;
  if (f.tags.includes('egg')) return 'egg';
  if (f.tags.includes('tuna')) return 'tuna';
  if (f.tags.includes('fish')) return 'fish';
  if (f.tags.includes('meat')) return 'meat';
  if (f.tags.includes('supplement')) return 'supplement';
  if (f.tags.includes('legume')) return 'legume';
  if (f.tags.includes('dairy') && f.p >= 5) return 'dairy';   // קוטג'/יוגורט/גבינה — לא חלב שתייה
  return null;
}
const hasProteinAnchor = m => !!(m && m.items && m.items.some(it => proteinAnchor(it.f)));

// האם מותר להוסיף את f לארוחה m? מתוק ומלוח לא נפגשים; ניטרלי עובר תמיד.
function tasteOk(f, m) {
  const p = tasteProfile(f);
  if (p === 'neutral' || !m || !m.items) return true;
  const opposite = p === 'sweet' ? 'savory' : 'sweet';
  return !m.items.some(it => tasteProfile(it.f) === opposite);
}

const MEAL_TEMPLATES = {
  breakfast: [
    { name:'eggs',        weight:3, slots:[
      { match:_tag('egg'),   calPct:.45, protPct:.85, max:300 },
      { match:_tag('bread'), calPct:.35, max:65, spread:'ifAlone', pitaOk:true },   // פיתה מותרת כאן (עם חביתה), בעדיפות נמוכה
      { special:'salad', optional:true },
    ]},
    { name:'cheese',      weight:3, slots:[
      { match:isCheese,      calPct:.45, protPct:.85, max:200 },
      { match:_sliced,       calPct:.35, max:65, spread:'ifAlone' },   // לחם/פריכית, לא פיתה
      { special:'salad', optional:true },
    ]},
    { name:'yogurt_bowl', weight:2, slots:[
      { match:isYogurt,      calPct:.5, protPct:.8, max:250 },
      { match:_tag('granola'), calPct:.3, max:60, optional:true },   // גרנולה בלבד (לא שיבולת מבושלת)
      { match:_tag('sweet_topping'), calPct:.1, max:30, optional:true },   // דבש/סילן (כלום/אחד מהם)
      { match:_tag('fruit'), calPct:.2, max:200, optional:true },
    ]},
    { name:'porridge',    weight:2, slots:[
      { match:f => f.id === 106, calPct:.6, max:350 },
      { match:_tag('sweet_topping'), calPct:.1, max:30, optional:true },   // דבש/סילן
      { match:_tag('fruit'),     calPct:.4, max:200, optional:true },
    ]},
    { name:'cornflakes',  weight:2, slots:[
      { match:f => f.id === 108, calPct:.4, max:60 },
      { match:f => f.drink,      calPct:.35, max:250 },
      { match:_tag('fruit'),     calPct:.25, max:200, optional:true },
    ]},
    { name:'oats_water',  weight:1, slots:[   // צמחוני/טבעוני וגיוון: שיבולת במים
      { match:f => f.id === 41, calPct:.5, max:300 },
      { match:_tag('sweet_topping'), calPct:.1, max:30, optional:true },   // דבש/סילן
      { match:_tag('fruit'), calPct:.3, max:200, optional:true },
      { match:_tag('nuts'), calPct:.2, max:30, optional:true },   // אגוזים בלבד
    ]},
    // טבעוני (ובפרט טבעוני+ללא גלוטן): לחם/פריכית עם ממרח + פרי/אגוזים — רק כשאין ביצה/חלב זמינים
    { name:'bread_spread', weight:1, when:u => !ALL.some(f => (f.tags.includes('egg') || f.tags.includes('dairy')) && allowed(f) && !u.has(f.id)), slots:[
      { match:_sliced, calPct:.5, max:65, spread:'ifAlone' },
      { match:_tag('fruit'), calPct:.3, max:200, optional:true },
      { match:_tag('nuts'), calPct:.2, max:30, optional:true },
    ]},
  ],
  hot: [
    { name:'meat',   weight:3, slots:[
      { match:f => (f.tags.includes('meat') || f.tags.includes('fish')) && !f.tags.includes('tuna'), calPct:.45, protPct:.9, max:300 },
      { special:'hot_side', calPct:.4, max:250 },   // תוספת אחת: דגן או קטנייה (לא שתיהן)
      { special:'hotveg_or_salad', optional:true },
      { special:'dip', optional:true },             // ~25%: חומוס/טחינה בצד
    ]},
    // קטנייה כעיקרית — רק לצמחוני/טבעוני (אין להם בשר)
    { name:'legume', weight:1, when:u => !ALL.some(f => (f.tags.includes('meat') || f.tags.includes('fish')) && !f.tags.includes('tuna') && allowed(f) && !u.has(f.id)), slots:[
      { match:f => f.tags.includes('legume') && !f.dip, calPct:.4, protPct:.9, max:300 },
      { special:'hot_carb', calPct:.4, max:250 },
      { special:'hotveg_or_salad', optional:true },
      { special:'dip', optional:true },             // ~25%: חומוס/טחינה בצד
    ]},
    // הערה: אין טונה בארוחה חמה — צהריים = בשר/דג מבושל. טונה זמינה בארוחת ערב (tuna_bread).
  ],
  snack: [
    { name:'dairy_fruit',    weight:3, slots:[
      { match:f => isYogurt(f) || f.id === 20 || f.id === 21, calPct:.6, protPct:.85, max:250 },  // קוטג'/יוגורט (לא גבינה לבנה/צהובה — אלו עם לחם/פריכית)
      { match:_tag('fruit'), calPct:.4, max:200, optional:true },
    ]},
    { name:'fruit_nuts',     weight:2, slots:[
      { match:_tag('fruit'), calPct:.55, max:200 },
      { match:_tag('nuts'), calPct:.45, max:30 },   // אגוזים אמיתיים בלבד (לא אבוקדו/זיתים)
    ]},
    { name:'carb_cheese', weight:2, slots:[
      { match:isCheese, calPct:.45, protPct:.6, max:120, optional:true },
      { match:_sliced, calPct:.45, max:65, spread:'ifAlone' },   // לחם/פריכית (לא רק פריכית) — כך הנשנוש תמיד אפשרי גם כשהפריכית חסומה (קבוצת וריאנט)
    ]},
    { name:'shake',          weight:2, slots:[
      { match:_tag('supplement'), calPct:.7, protPct:.9, max:60 },
      { match:_tag('fruit'), calPct:.3, max:200, optional:true },
    ]},
  ],
  dinner: [
    { name:'cheese_bread', weight:3, slots:[
      { match:f => isCheese(f) || f.tags.includes('egg'), calPct:.45, protPct:.8, max:250 },
      { match:_sliced, calPct:.25, max:65, spread:'ifAlone', optional:true },   // לחם פרוס, לא פיתה
      { special:'salad', optional:true },
    ]},
    { name:'tuna_bread',   weight:2, slots:[
      { match:(f, u) => f.tags.includes('tuna') && !tunaUsed(u), calPct:.4, protPct:.8, max:160 },
      { match:_sliced, calPct:.25, max:65, spread:'ifAlone', optional:true },   // לחם פרוס, לא פיתה
      { special:'salad', optional:true },
    ]},
    { name:'big_salad',    weight:2, slots:[
      { special:'salad' },
      // חלבון: ביצה/גבינה (מן החי). קטנייה רק כשאין למשתמש חלבון מן החי (טבעוני) — שעועית אינה "מנת חלבון" לאוכלי-כול
      { match:f => f.tags.includes('egg') || isCheese(f) || (f.tags.includes('legume') && !f.dip && !hasAnimalProtein()), calPct:.45, protPct:.8, max:250 },
      { match:_sliced, calPct:.2, max:65, spread:'ifAlone', optional:true },   // לחם פרוס, לא פיתה
    ]},
  ],
};

// ממרח (טחינה/חמאת בוטנים) — נצמד ללחם/פריכייה: השם מציין "עם X",
// והממרח עצמו מקבל שורה נפרדת עם כמות וקלוריות משלו. מחזיר את שורת הממרח (או null).
function makeSpread(breadItem, used) {
  const spreads = ALL.filter(f => f.condiment && !f.tags.includes('oil') && allowed(f) && !used.has(f.id));
  if (!spreads.length) return null;
  const liked = spreads.filter(f => S.liked.has(f.id));
  if (!liked.length && Math.random() >= 0.4) return null;
  const pool = liked.length ? liked : spreads;
  const f = pool[Math.floor(Math.random() * pool.length)];
  const g = f.unitG || 15;
  breadItem.displayName = (breadItem.displayName || breadItem.f.name) + ' עם ' + f.name;
  use(used, { f, g });
  return mkItem(f, g);
}

const SELF_USE = ['salad', 'hotveg', 'hotveg_or_salad']; // ממלאים את used בעצמם

// כשרות: בלי בשר וחלב באותה ארוחה (דג+חלב מותר — טונה+קוטג' נשאר). התבניות ממילא
// לא מערבבות, אבל זו ערובה מפורשת שתחזיק גם מול תבניות עתידיות.
const kosherOk = (f, mealTags) => !S.diet.has('kosher') ||
  !((f.tags.includes('dairy') && mealTags.has('meat')) ||
    (f.tags.includes('meat')  && mealTags.has('dairy')));

function buildFromTemplate(tpl, cal, used, ctx) {
  const items = [];
  const protShare = S.proteinG * cal / S.target;
  const mealTags = new Set();   // תגי הפריטים שכבר בארוחה — לאכיפת כשרות
  let hasProtein = false;
  for (const s of tpl.slots) {
    let item = null;
    if (s.special === 'salad') {
      item = buildSalad(used);
    } else if (s.special === 'hotveg') {
      item = buildSingleVeg(used, true);
    } else if (s.special === 'hotveg_or_salad') {
      const ph = Math.random() < 0.4;
      item = ph ? buildSingleVeg(used, true) : buildSalad(used);
      if (!item) item = ph ? buildSalad(used) : buildSingleVeg(used, true);
    } else if (s.special === 'hot_carb' || s.special === 'hot_side') {
      // hot_side: קטנייה כתוספת לצד הבשר רק אם המשתמש אוהב אותה — ופעם אחת ביום. קטנייה היא מנוף
      // חלבון (שלב 1), לא פחמימה: יום שכל התוספות בו קטניות נשאר בלי מנוף קלוריות גמיש ונתקע
      // עמוק מתחת ליעד (נמדד: עד -33%). התוספת השנייה תמיד דגן.
      if (s.special === 'hot_side') {
        const legUsed = [...used.keys()].some(id => LEGUME_SIDE_IDS.has(id));
        const wantLeg = !legUsed && ALL.some(f => f.tags.includes('legume') && !f.dip && S.liked.has(f.id) && allowed(f));
        if (wantLeg) item = pick(ALL.filter(f => f.tags.includes('legume') && !f.dip), used, cal * (s.calPct || .4), 0, s.max || 250);
      }
      if (!item) {
        const getCarbCat = f => f.tags.find(t => t === 'grain' || t === 'starch') || 'other';
        const allHc = ALL.filter(f => f.tags.includes('hot_carb'));
        const cats = (ctx && ctx.usedCarbCats) || new Set();
        // ארוחה חמה יחידה: מעדיפים דגן גמיש (מנוף קלוריות — שם היום נתקע מתחת ליעד), והבטטה לגיוון
        // מגיעה דרך פיצול-הפחמימה. צהריים/ערב: גיוון קטגוריה כרגיל (עמילן יכול להיות הפחמימה המרכזית).
        const elastic = allHc.filter(f => isElasticGrain(f));
        const base = (singleHotMeal() && elastic.length) ? elastic : allHc;
        const prefHc = base.filter(f => !cats.has(getCarbCat(f)));
        item = pick(prefHc.length ? prefHc : base, used, cal * (s.calPct || .4), 0, s.max || 250);
        if (!item && base !== allHc) item = pick(allHc, used, cal * (s.calPct || .4), 0, s.max || 250);   // נפילה לעמילן אם הדגן נחסם
        if (item) cats.add(getCarbCat(item.f));
      }
    } else if (s.special === 'dip') {
      // ~25% (או אם אהוב): חומוס/טחינה כמטבל בצד — שורה משלו
      const dips = ALL.filter(f => f.dip && allowed(f) && !used.has(f.id) && kosherOk(f, mealTags));
      const wantDip = dips.some(f => S.liked.has(f.id)) || Math.random() < 0.25;
      if (wantDip && dips.length) item = pick(dips, used, cal * (s.calPct || .15), 0, s.max || 50);
    } else {
      // בכשר, ארוחה בחלון 6ש' אחרי בשר (ctx.noDairy) — מסננים חלב (כולל שיבולת-בחלב/וויי/קזאין)
      let pool = ALL.filter(f => s.match(f, used) && kosherOk(f, mealTags) && !(ctx && ctx.noDairy && isDairyKosher(f)));
      // פיתה בעדיפות נמוכה ורק במשבצת שמסומנת pitaOk (חביתה); אחרת לחם/פריכיות
      if (pool.some(f => f.pita) && (!s.pitaOk || Math.random() >= 0.3)) pool = pool.filter(f => !f.pita);
      item = pick(pool, used, cal * (s.calPct || .3), s.protPct ? protShare * s.protPct : 0, s.max || 250);
    }
    if (!item) continue;
    // מנת חלבון מרכזית (בשר/דג בארוחה חמה, protPct) — רצפת מנה ריאליסטית כדי שלא תצא זעירה (30g)
    if (s.protPct && item.f && (item.f.tags.includes('meat') || item.f.tags.includes('fish')) && !item.f.tags.includes('tuna')) {
      item._mainProt = true; item._minG = mainProtFloor();
    }
    if (item.f) item.f.tags.forEach(t => mealTags.add(t));   // עדכון תגי הארוחה (סלט = ירקות בלבד, לא רלוונטי לכשרות)
    // ממרח רק כשאין כבר חלבון בארוחה (קוטג'/ביצה/טונה ⇐ אין צורך בממרח)
    let spreadItem = null;
    if (s.spread && !item.isSaladGroup && !(s.spread === 'ifAlone' && hasProtein))
      spreadItem = makeSpread(item, used);
    items.push(item);
    if (!SELF_USE.includes(s.special)) use(used, item);
    if (spreadItem) items.push(spreadItem);
    if (s.protPct) hasProtein = true;
  }
  return items;
}

function slotFeasible(s, used, ctx) {
  if (s.optional) return true;   // משבצת אופציונלית לעולם לא מפילה תבנית (חלב-אופציונלי בכשר יוצא ריק, לא חוסם)
  if (s.special === 'salad')
    return ALL.filter(f => f.tags.includes('salad') && !f.tags.includes('salad_only') && allowed(f) && !used.has(f.id)).length >= 2;
  if (s.special) return true; // hot_carb / hotveg — כמעט תמיד זמינים
  return ALL.some(f => s.match(f, used) && allowed(f) && !used.has(f.id) && !variantBlocked(f, used) &&
    !(ctx && ctx.noDairy && isDairyKosher(f)));   // בכשר, משבצת-חובה שרק חלב ממלא אותה → תבנית לא-היתכנה
}
function tplHasLiked(tpl, used) {
  return tpl.slots.some(s => !s.special && ALL.some(f => s.match(f, used) && S.liked.has(f.id) && allowed(f)));
}
function chooseTemplate(list, used, ctx) {
  const feasible = list.filter(tpl => (!tpl.when || tpl.when(used)) && tpl.slots.every(s => slotFeasible(s, used, ctx)));
  if (!feasible.length) return null;
  const liked = feasible.filter(tpl => tplHasLiked(tpl, used));
  const pool = liked.length ? liked : feasible;
  const total = pool.reduce((a, t) => a + (t.weight || 1), 0);
  let r = Math.random() * total;
  for (const t of pool) { r -= (t.weight || 1); if (r <= 0) return t; }
  return pool[0];
}

function buildMeal(type, cal, used, ctx) {
  const tpl = chooseTemplate(MEAL_TEMPLATES[type], used, ctx);
  return tpl ? buildFromTemplate(tpl, cal, used, ctx) : [];
}

// "החלפת ארוחה שמתאימה": בונים 5 פעמים (תבניות אקראיות) ובוחרים את הטובה בניקוד,
// כדי לדייק בלי לנפח מנה בודדת. עובדים על עותק של used ומאמצים את ניצולי הזוכה.
function buildMealBest(type, budget, used, ctx) {
  const expFat = S.fatG * budget / Math.max(S.target, 1);   // חלק השומן הצפוי לארוחה
  const expFib = S.fibG * budget / Math.max(S.target, 1);   // חלק הסיבים הצפוי לארוחה
  let best = null, bestUsed = null, bestScore = Infinity;
  for (let i = 0; i < 5; i++) {
    const u = new Map(used);
    const items = buildMeal(type, budget, u, ctx);
    if (!items.length) continue;
    const cal = items.reduce((s, x) => s + x.cal, 0);
    const fat = items.reduce((s, x) => s + (x.fat || 0), 0);
    const fib = items.reduce((s, x) => s + (x.fib || 0), 0);
    // ניקוד: קרבה לתקציב קלורי + עדיפות לבנייה רזה (כדי לרסן שומן מהמקור)
    // + סיבים מהמקור: קנס על מחסור מול החלק היחסי (רצפה) וקנס על עודף רק מעל ~2.2× (רצועה
    //   רחוקה — מרסן ערימות קטניות טבעוניות בלי לגעת בתפריט רגיל). כמו השומן: אין שלב reconcile.
    const score = Math.abs(cal - budget) / Math.max(budget, 1)
                + 0.6 * Math.max(0, fat - expFat) / Math.max(expFat, 8)
                + 0.7 * Math.max(0, expFib - fib) / Math.max(expFib, 4)
                + 0.5 * Math.max(0, fib - 2.5 * expFib) / Math.max(expFib, 4);
    if (score < bestScore) { bestScore = score; best = items; bestUsed = u; }
  }
  if (bestUsed) { used.clear(); bestUsed.forEach((v, k) => used.set(k, v)); }
  return best || [];
}

// ארוחה ש"איבדה" את הבשר בריכוז (אוכלי-כול): במקום פחמימה+סלט חשופה, *משאירים* את הפחמימה
// (חיוני — היא מנוף הקלוריות הגמיש של היום) ורק *מוסיפים עוגן חלבון קל* בהגרלה משוקללת:
// ביצה (~50%), קוטג'/יוגורט (~33%), קטנייה (~17%, "כבדה" → משקל נמוך). ביצה/קטנייה גמישים
// (שלב 1 מאזן אותם); קוטג' קבוע. נפילה-לאחור לפי משקל יורד. מחזיר true אם נוסף עוגן.
function convertDemeatedMeal(meal, used, ctx) {
  const cal = meal.budget || meal.totCal || 500;
  const protShare = S.proteinG * cal / Math.max(S.target, 1);   // יעד חלבון מקורב לארוחה
  const anchor = (filter, calPct, max) => {
    // tasteOk גם כאן: העוגנים (ביצה/קטנייה) מלוחים, והארוחה שאיבדה בשר מלוחה בעצמה,
    // אז בפועל זה תמיד עובר — אבל השער מונע פרצה אם מאגר העוגנים יורחב בעתיד.
    const pool = ALL.filter(f => filter(f) && allowed(f) && !used.has(f.id) && tasteOk(f, meal));
    return pool.length ? pick(pool, used, cal * calPct, protShare, max) : null;
  };
  const strats = [
    { w: 3, build: () => anchor(f => f.tags.includes('egg'), .35, 200) },                          // ביצים + פחמימה + סלט
    // עוגן קוטג'/יוגורט — מושמט בכשר: הארוחה שאיבדה בשר צמודה לארוחת הבשר שנשמרה, וחלב לצידה יפר הפרדה
    ...(S.diet.has('kosher') ? [] : [{ w: 2, build: () => anchor(f => f.id === 20 || f.id === 21 || isYogurt(f), .4, 250) }]),   // קוטג'/יוגורט + פחמימה
    { w: 1, build: () => { const it = anchor(f => f.tags.includes('legume') && !f.dip && f.p >= 7, .4, 250);   // קטנייה עתירת-חלבון (עדשים/חומוס/שעועית) — לא אפונה
                           if (it) { it._minG = Math.min(it.g, 120);                                // רצפה כדי ששלב-1 לא יכווץ אותה לסמלית
                             meal.items.forEach(x => {                                               // תוחמים את הפחמימה כשיש קטנייה (העודף לארוחת הבשר), כדי שלא יהיה "הר"
                               if (isElasticGrain(x.f)) x._maxG = 250;                               // דגן ≤250g
                               else if (x.f && x.f.plural && x.f.unitG && x.f.tags.includes('starch')) x._maxG = 2 * x.f.unitG; }); }  // עמילן ≤2 יחידות
                           return it; } },
  ];
  while (strats.length) {
    const total = strats.reduce((a, s) => a + s.w, 0);
    let r = Math.random() * total, idx = 0;
    for (let i = 0; i < strats.length; i++) { r -= strats[i].w; if (r <= 0) { idx = i; break; } }
    const item = strats[idx].build();
    if (item) { use(used, item); meal.items.unshift(item); return true; }   // העוגן בראש הארוחה
    strats.splice(idx, 1);   // אסטרטגיה נכשלה — נפילה לאחור
  }
  return false;
}

// ══════════════════════════════════════════
//  יישור מאקרו ליעד — reconcile (חלבון ±7% → שומן ±8% → קלוריות ±4%)
// ══════════════════════════════════════════
const CAL_TOL  = 0.04;
const PROT_TOL = 0.07;
const FAT_TOL  = 0.08;

// המנופים שבהם reconcile מכוונן כמויות. כולם מעדכנים g + dispG (תווית אמת) + מאקרו (setMacros).
function reG(it, g) {            // כמות חופשית בגרמים (דגן/בשר/דג/קטנייה)
  it.g = g; it.dispG = `${g}g`;
  setMacros(it, it.f, g);
}
function reBread(it, count) {    // לחם פרוס לפי מספר פרוסות (1–2): "פרוסה אחת" / "2 פרוסות"
  count = Math.max(1, Math.min(2, count || 1));
  it.g = count * (it.f.unitG || 30);
  it.dispG = count === 1 ? (it.f.unitLabel || 'פרוסה אחת') : `${count} פרוסות`;
  setMacros(it, it.f, it.g);
}
function reNuts(it, g) {         // אגוזים בגרמים (10–40) — מנוף שומן עדין; תווית "15g שקדים"
  it.g = Math.max(10, Math.min(40, Math.round(g))); it.dispG = `${it.g}g`;
  setMacros(it, it.f, it.g);
}
function reCracker(it, targetG) {  // פריכיות לפי מספר יחידות (2–6, דרך crackerPortion)
  const c = crackerPortion(targetG, it.f.unitG || 9);
  it.g = c.g; it.dispG = c.dispG;
  setMacros(it, it.f, c.g);
}
function reUnit(it, count) {     // ירק עמילני לפי יחידות שלמות (1–3, תקרת CARBCAP): "2 תפוחי אדמה בינוניים"
  let maxN = Math.max(1, Math.min(3, Math.floor(450 / it.f.unitG)));
  if (it._maxG) maxN = Math.max(1, Math.min(maxN, Math.floor(it._maxG / it.f.unitG)));   // תקרת פר-פריט (למשל בארוחת קטניות)
  count = Math.max(1, Math.min(maxN, count || 1));
  it.g = count * it.f.unitG;
  it.dispG = count === 1 ? it.f.unitLabel : `${count} ${it.f.plural}`;
  setMacros(it, it.f, it.g);
}

// ══════════════════════════════════════════
//  השלמת ארוחה שנגזמה (13/08/2026)
//  הסרת פריט נעלה עד היום את הארוחה, ולכן האיזון לא יכול היה להשלים אותה והוסיף
//  "נשנוש נוסף" בסוף היום במקום לתקן את הצהריים שקוצצו.
//  כאן **בונים לתוך הארוחה הקיימת** ולא מחדש, בדיוק בדפוס של convertDemeatedMeal:
//  הפול מסונן ב-tasteOk **מול הארוחה עצמה**, ולכן מה שנכנס חייב להסתדר עם מה שנשאר
//  בצלחת. pick כבר אוכף allowed / used / variantBlocked, אז קבוצות הווריאנטים
//  וגיוון היום מוגנים בלי קוד נוסף.
//  ⚠️ המאכל שהוסר לא חוזר — זו כל הסיבה שהמשתמש הסיר אותו.
// ══════════════════════════════════════════
function topUpMeal(meal, used, ctx) {
  if (!meal || !Array.isArray(meal.trimOut) || !meal.trimOut.length) return { added: 0, left: 0 };
  used = used || new Map(); ctx = ctx || { usedCarbCats: new Set() };

  const excl  = new Set(meal.trimOut.map(t => t.id).filter(id => id > 0));
  let gapCal  = Math.round(meal.trimOut.reduce((s, t) => s + (t.cal || 0), 0));
  const gapP  = Math.round(meal.trimOut.reduce((s, t) => s + (t.p || 0), 0));
  // "אותה משפחה": מחליפים ממרח בממרח ופחמימה בפחמימה, ולא שניצל בבוקר. tasteOk
  // חוסם מתוק מול מלוח, אבל לא "מנה חמה בתוך ארוחת בוקר" — הקרבה הזאת סוגרת את הפער.
  const kinTags = new Set(meal.trimOut.flatMap(t => t.tags || []));

  // ⚠️ **פריט שני חייב להיות ממשפחה אחרת.** בלי זה ההשלמה בחרה פעמיים מאותה
  //    קבוצה והכניסה כוסמת *וגם* פסטה לאותה צלחת — מספרים נכונים, ארוחה לא הגיונית.
  //    (נתפס בבדיקה 13/08/2026, וזה בדיוק הסיכון שבגללו מודדים קוהרנטיות ולא רק מאקרו.)
  const takenTags = new Set();
  let added = 0;
  for (let k = 0; k < 2 && gapCal >= 60; k++) {
    const base = ALL.filter(f => !excl.has(f.id) && tasteOk(f, meal) &&
      !f.tags.some(t => takenTags.has(t)));
    const kin  = kinTags.size ? base.filter(f => f.tags.some(t => kinTags.has(t))) : [];
    // מנסים קודם מאותה משפחה כמו מה שהוסר (ממרח בממרח, עמילן בעמילן); אם אין, כל
    // מה שעובר את שער הטעם. maxG הוא תקרת **גרמים**, לא קלוריות.
    const it = pick(kin.length ? kin : base, used, gapCal, k === 0 ? gapP : 0, 350);
    if (!it) break;
    use(used, it);
    (it.f.tags || []).forEach(t => takenTags.add(t));
    meal.items.push(it);
    gapCal -= it.cal;
    added++;
  }

  recalcMeal(meal);
  // לחיצה אחת, ומה שנכנס נכנס. מה שנשאר יתבטא כיום מתחת ליעד, ושם כבר יש
  // אזהרה רוחבית עם כפתור — זו החלוקה שהוכרעה: המקומי לארוחה, הרוחבי ליום.
  meal.trimOut = [];
  meal.trimmed = false;
  return { added, left: Math.max(0, gapCal) };
}

function recalcMeal(m) {
  m.totCal = m.items.reduce((s, x) => s + x.cal, 0);
  m.totP   = Math.round(m.items.reduce((s, x) => s + (x.p   || 0), 0) * 10) / 10;
  m.totC   = Math.round(m.items.reduce((s, x) => s + (x.c   || 0), 0) * 10) / 10;
  m.totF   = Math.round(m.items.reduce((s, x) => s + (x.fat || 0), 0) * 10) / 10;
  m.totFib = Math.round(m.items.reduce((s, x) => s + (x.fib || 0), 0) * 10) / 10;
}

// כיוונון ביצה: בוחר גודל (M/15 ל-L/16 ל-XL/17) וכמות (1–2) הכי קרובים ליעד הגרמים.
// ערכי המאקרו ל-100g זהים בכל הגדלים — רק המשקל משתנה.
function adjustEgg(it, targetG) {
  let sizes = [15, 16, 17].map(id => ALL.find(f => f.id === id)).filter(Boolean);
  const likedSizes = sizes.filter(ef => S.liked.has(ef.id));
  if (likedSizes.length) sizes = likedSizes;   // המשתמש סימן גודל ביצה מועדף — לא מחליפים לו אותו
  let best = null, bestDiff = Infinity;
  for (const ef of sizes) for (const n of [1, 2]) {
    const g = ef.unitG * n, d = Math.abs(g - targetG);
    if (d < bestDiff) { bestDiff = d; best = { ef, g }; }
  }
  if (!best) return;
  it.f = best.ef;
  const size = best.ef.name.replace('ביצה ', '');
  const e = eggDisplay(best.g, best.ef.unitG, size);
  it.g = e.g; it.displayName = e.label; it.dispG = '';
  setMacros(it, best.ef, it.g);
}

// כיוונון שומן (שלב 2): שמן סלט → אגוזים קיימים → הוספת אגוזים לנשנוש → החלפת חלבון שמן ברזה.
// שמן זית = 100% שומן (רציף), ולכן השומן מתכוונן עדין; ההחלפה לרזה פותרת "שומן תקוע גבוה".
function adjustFat(meals) {
  const items = meals.flatMap(m => m.items);
  const usedIds = new Set(items.map(it => it.f && it.f.id));
  const dF = meals.reduce((s, m) => s + m.totF, 0);
  let delta = S.fatG - dF;                        // חיובי = להוסיף שומן
  if (Math.abs(delta) <= S.fatG * FAT_TOL) return;
  const snapOil = g => Math.max(0, Math.min(10, Math.round(g / 5) * 5));   // 0/1/2 כפיות

  if (delta > 0) {
    // 1) שמן סלט (גרם שמן = גרם שומן), בכפיות שלמות
    items.filter(it => it.isSaladGroup && it._oil).forEach(sg => {
      if (delta <= 0) return;
      const before = sg._oilG || 0;
      sg._oilG = snapOil(before + delta);
      delta -= (sg._oilG - before); recalcSalad(sg);
    });
    // 2) אגוזים קיימים (גרם אגוז = f% שומן)
    items.filter(it => it.f && it.f.tags.includes('nuts')).forEach(it => {
      if (delta <= 0 || !it.f.f) return;
      const before = it.fat;
      reNuts(it, it.g + delta / (it.f.f / 100));
      delta -= (it.fat - before);
    });
    // 3) אם עדיין חסר ואין אגוזים כלל — מנת אגוזים קטנה לנשנוש (בית הגיוני לאגוזים)
    if (delta > S.fatG * FAT_TOL && !items.some(it => it.f && it.f.tags.includes('nuts'))) {
      const snack = meals.find(m => m.type === 'snack') || meals[meals.length - 1];
      const cand = [88, 89, 90].map(id => ALL.find(f => f.id === id)).filter(f => f && allowed(f) && !usedIds.has(f.id));
      const nut = cand.find(f => S.liked.has(f.id)) || cand[0];
      if (snack && nut && nut.f) {
        const it = mkItem(nut, nut.unitG || 30);
        reNuts(it, delta / (nut.f / 100));
        snack.items.push(it);
      }
    }
  } else {
    let need = -delta;                            // גרם שומן להוריד
    // 0) החלפה לגרסה רזה ששומרת חלבון/מנה: טונה בשמן→במים, קוטג' 5%→3%, יוגורט 5%→0% (יש לזה הכי הרבה תשואה)
    const LEANER = { 9: 10, 20: 21, 24: 23 };
    items.forEach(it => {
      if (need <= 0 || !it.f || !(it.f.id in LEANER) || S.liked.has(it.f.id)) return;   // לא מחליפים מאכל אהוב
      const lean = ALL.find(f => f.id === LEANER[it.f.id]);
      if (!lean || !allowed(lean) || usedIds.has(lean.id)) return;
      const before = it.fat;
      it.f = lean; setMacros(it, lean, it.g);   // אותה כמות, מזון רזה יותר
      need -= (before - it.fat);
    });
    items.filter(it => it.isSaladGroup && it._oil && it._oilG > 0).forEach(sg => {
      if (need <= 0) return;
      const before = sg._oilG;
      sg._oilG = snapOil(before - need);
      need -= (before - sg._oilG); recalcSalad(sg);
    });
    items.filter(it => it.f && it.f.tags.includes('nuts') && it.g > 10).forEach(it => {
      if (need <= 0 || !it.f.f) return;
      const before = it.fat;
      reNuts(it, it.g - need / (it.f.f / 100));
      need -= (before - it.fat);
    });
    // החלפת חלבון שמן ברזה (משמר חלבון, חותך שומן) — רק אם עדיין מעל הסבולת
    if (need > S.fatG * FAT_TOL) {
      const prot = items.filter(it => it.f && !it.f.isEgg && !it.f.unitLabel && !S.liked.has(it.f.id) &&
        (it.f.tags.includes('meat') || it.f.tags.includes('fish')));   // לא מחליפים חלבון אהוב
      const fattest = prot.sort((a, b) => b.f.f - a.f.f)[0];
      if (fattest && fattest.f.f > 5) {
        const tag = fattest.f.tags.includes('fish') ? 'fish' : 'meat';
        const lean = ALL.filter(f => f.tags.includes(tag) && !f.tags.includes('tuna') &&
          allowed(f) && !usedIds.has(f.id) && f.f < fattest.f.f && f.p > 0)
          .sort((a, b) => a.f - b.f)[0];
        // שימור רצפת/תקרת המנה המרכזית גם בהחלפה (סלמון 90g→הודו לפי חלבון היה יורד ל-66g, מתחת לרצפה)
        if (lean) {
          const protG = fattest.p; fattest.f = lean;
          const g = Math.max(fattest._minG || 30,
            Math.min(fattest._mainProt ? mainProtCap() : 350, Math.round(protG / lean.p * 100)));
          reG(fattest, g);
        }
      }
    }
  }
  meals.forEach(recalcMeal);
}

// יישור מאקרו ב-3 שלבים: (1) חלבון ±7% (2) שומן ±8% (3) פחמימות → קלוריות ±4%.
// פריטים בעלי "כמות טבעית" (פרוסה/בננה/קופסה/פריכייה) לא משתנים בשלב הקלוריות.
function reconcile(meals, used, ctx) {
  used = used || new Map(); ctx = ctx || { usedCarbCats: new Set() };
  const items = () => meals.flatMap(m => m.items);
  const isCarb = it => it.f && !it.f.unitLabel &&
    (it.f.tags.includes('hot_carb') || it.f.tags.includes('grain') || it.f.tags.includes('starch'));
  const isProt = it => it.f && !it.isSaladGroup && !it.f.dip &&
    (it.f.isEgg || ((it.f.tags.includes('meat') || it.f.tags.includes('fish') ||
      (it.f.tags.includes('legume') && it.f.p >= 7)) && !it.f.unitLabel));   // קטנייה דלת-חלבון (אפונה) אינה מנוף — רק מתנפחת וגוררת סיבים
  const clampG = (it, g) => {
    if (it.f.unitG) g = Math.round(g / it.f.unitG) * it.f.unitG;
    // מנה מרכזית (בשר/דג) מוגבלת לצלחת ריאלית (mainProtCap); שאר הפריטים — תקרת שפיות 350
    const max = Math.min(it.f.maxMeal || 99999, it.f.maxDay || 99999, it._mainProt ? mainProtCap() : 350);
    return Math.max(it._minG || it.f.unitG || 30, Math.min(g, max));   // רצפת מנה מרכזית (_minG) מכובדת בכל שלבי האיזון
  };

  // רצפת החלבון היומית שאף שלב איזון לא יורד מתחתיה: 1.6 ג/ק"ג, ולעולם לא מעל היעד עצמו.
  // היה כאן `S.proteinG * (vegan ? 1 : 0.8)` בשני מקומות — נכון למתאמן (0.8 × 2 = 1.6 בדיוק),
  // אבל אצל טבעוני *ומי שלא מתאמן* S.proteinG כבר מוקטן ל-1.6, ואז 0.8 ממנו = 1.28 ג/ק"ג.
  // טבעונים היו פטורים ידנית; זה משלים את אותו תיקון לכל פרופיל בעל יעד מוקטן. (אובחן 07/08/2026)
  const protCutFloor = () => Math.min(S.proteinG, Math.round((S.protRefW || S.weight) * 1.6));

  // רצפת מנת-חלבון מרכזית + ריכוז: מבטיחים מנת בשר/דג ריאליסטית (לא 30g) ולא מנפחים חלבון.
  // הארוחה הבשרית הגדולה ביותר נשמרת ומורמת לרצפה; ארוחת-בשר *נוספת* שתדחוף את החלבון >115%
  // מהיעד — מורידים ממנה את הבשר (נשארת פחמימה+ירק). במקרה קיצון (משקל נמוך) = ארוחה בשרית אחת.
  // הפחמימות יסגרו את הפרש הקלוריות ב-Stage 3.
  {
    // הארוחה ששורדת מועדפת להיות צמודת-אימון (tag pre/post), ואז הגדולה בגרמים.
    // תזמון מול אימון משני ל-ISSN, אך כשמרכזים ממילא לארוחה אחת — שתשב על האימון.
    const mealOf = it => meals.find(m => m.items.includes(it));
    const isWk = it => { const m = mealOf(it); return m && m.tag ? 1 : 0; };
    const mains = items().filter(it => it._mainProt)
      .sort((a, b) => (isWk(b) - isWk(a)) || (b.g - a.g));
    mains.forEach((it, k) => {
      const flooredP = it.f.p * (it._minG || 0) / 100;
      const projTot = meals.reduce((s, m) => s + m.totP, 0) - it.p + Math.max(it.p, flooredP);
      if (k > 0 && projTot > S.proteinG * 1.15) {
        const meal = mealOf(it);
        if (meal) {
          meal.items = meal.items.filter(x => x !== it);
          const prev = used.get(it.f.id) || 0; const left = prev - it.g;   // משחררים את הבשר שהוסר מ-used
          if (left > 0) used.set(it.f.id, left); else used.delete(it.f.id);
          // במקום פחמימה+סלט חשופה: משאירים את הפחמימה ומוסיפים עוגן חלבון קל. טבעוני/צמחוני לא נכנס.
          let converted = false;
          if (!S.diet.has('vegan') && !S.diet.has('vegetarian'))
            converted = convertDemeatedMeal(meal, used, ctx);
          if (!converted && !meal.items.length) meal.removed = true;
          recalcMeal(meal);
        }
      } else if (it.g < (it._minG || 0)) {
        reG(it, it._minG);
        const meal = mealOf(it);
        if (meal) recalcMeal(meal);
      } else if (it.g > mainProtCap()) {
        // תקרת צלחת גם על מנה שנבנתה גדולה מלכתחילה (משבצת התבנית מרשה עד 300)
        reG(it, clampG(it, it.g));
        const meal = mealOf(it);
        if (meal) recalcMeal(meal);
      }
    });
  }

  let protInjected = false;
  for (let outer = 0; outer < 6; outer++) {
    // ── שלב 1: חלבון → ±10% ──
    const dP = meals.reduce((s, m) => s + m.totP, 0);
    if (Math.abs(dP - S.proteinG) > S.proteinG * PROT_TOL) {
      const pool = items().filter(isProt);
      const poolP = pool.reduce((s, it) => s + it.p, 0) || 1;
      const delta = S.proteinG - dP;
      pool.forEach(it => {
        const targetP = it.p + delta * (it.p / poolP);
        const targetG = it.f.p > 0 ? targetP / it.f.p * 100 : it.g;
        if (it.f.isEgg) adjustEgg(it, targetG);
        else reG(it, clampG(it, Math.round(targetG)));
      });
      meals.forEach(recalcMeal);
    }

    // ── שלב 1ב: הזרקת מנת חלבון — כשכל המנופים בתקרה והחלבון עדיין חסר ──
    // קורה כשמנת הבשר הגיעה ל-mainProtCap (כבדים) או כשאין מספיק מקורות (צמחוני/כשר+ללא-לקטוז).
    // "עוד גביע ביום": מוסיפים פעם אחת מנה רזה (הכי הרבה חלבון לקלוריה) לארוחה הקלה הדלה בחלבון;
    // שלבים 2–3 של הלולאה סופגים את הקלוריות. מכבד כשרות/דיאטה/וריאנטים דרך pick/allowed.
    if (!protInjected) {
      const dP1 = meals.reduce((s, m) => s + m.totP, 0);
      const missP = S.proteinG - dP1;
      if (missP > S.proteinG * PROT_TOL) {
        protInjected = true;
        const cand = ALL.filter(f => (isCheese(f) || isYogurt(f) || f.isEgg || f.tags.includes('supplement') ||
            f.tags.includes('tuna') || (f.tags.includes('legume') && !f.dip && f.p >= 7)) &&
            (!f.tags.includes('tuna') || !tunaUsed(used)) && allowed(f))
          .sort((a, b) => ((S.liked.has(b.id) ? 1 : 0) - (S.liked.has(a.id) ? 1 : 0)) ||
                          (b.p / Math.max(b.cal, 1) - a.p / Math.max(a.cal, 1)));
        const targets = meals.filter(m => !m.removed && m.type !== 'treat' && m.type !== 'hot')
          .sort((a, b) => a.totP - b.totP);
        for (const f of cand) {
          // בכשר לא מזריקים חלב לארוחה בחלון 6ש' אחרי בשר (m.noDairy); מועמד פרווה (ביצה/טונה/קטנייה) מותר בכל מקום
          // tasteOk: לא מזריקים מלוח לארוחה מתוקה ולהפך. אם לאף ארוחה f לא מתאים —
          // עוברים למועמד הבא, ואם אף מועמד לא נכנס פשוט לא מזריקים. חלבון חסר
          // מדווח בכנות ב-S.menuWarning; ארוחה לא-קוהרנטית נראית לעין ואין לה תירוץ.
          const tm = targets.find(m => tasteOk(f, m) && !hasProteinAnchor(m) &&
            kosherOk(f, new Set(m.items.flatMap(x => x.f ? x.f.tags : []))) &&
            !(m.noDairy && isDairyKosher(f)));
          if (!tm) continue;
          const it = pick([f], used, missP * 5, missP, 260);
          if (!it) continue;
          use(used, it);
          tm.items.push(it);
          recalcMeal(tm);
          break;
        }
      }
    }

    // ── שלב 2: שומן → ±8% (שמן → אגוזים → הוספה לנשנוש → החלפת חלבון שמן ברזה) ──
    adjustFat(meals);

    // ── שלב 3: קלוריות → ±4% ע"י פחמימות (וכמוצא אחרון גם חלבון) ──
    const dCal = meals.reduce((s, m) => s + m.totCal, 0);
    if (dCal >= S.target * (1 - CAL_TOL) && dCal <= S.target * (1 + CAL_TOL)) {
      const dP2 = meals.reduce((s, m) => s + m.totP, 0);
      const dF2 = meals.reduce((s, m) => s + m.totF, 0);
      if (Math.abs(dP2 - S.proteinG) <= S.proteinG * PROT_TOL &&
          Math.abs(dF2 - S.fatG)     <= S.fatG     * FAT_TOL) break;   // קלוריות+חלבון+שומן בטווח
      continue;
    }
    const delta = S.target - dCal, grow = delta > 0;
    // לחם פרוס (1–4 פרוסות) ופריכיות (2–6) הם מנופי פחמימה נוספים — חיוני כי בוקר/ערב
    // לרוב חסרי פחמימה-בגרמים, ובללא-גלוטן הפריכיות הן הפחמימה המרכזית.
    const isBread   = it => it.f && it.f.tags.includes('bread') && !it.f.tags.includes('cracker') && !it.f.pita && it.f.unitG;
    const isCracker = it => it.f && it.f.tags.includes('cracker') && it.f.unitG;
    const isUnitCarb = it => it.f && it.f.plural && it.f.unitG && it.f.tags.includes('starch');   // בטטה/תפו"א/תירס — 1–3 יחידות
    const isCount   = it => isBread(it) || isCracker(it) || isUnitCarb(it);
    const maxOf = it => isBread(it) ? it.f.unitG * 2 : isCracker(it) ? it.f.unitG * crackerMaxN(it.f.unitG)
      : isUnitCarb(it) ? Math.min(it._maxG || 99999, Math.max(1, Math.min(3, Math.floor(450 / it.f.unitG))) * it.f.unitG)
      : Math.min(it._maxG || 99999, it.f.maxMeal || 99999, it.f.maxDay || 99999, grainCap(it.f));
    // פריכיות ≥~16g. דגן גמיש נשאר עם מינימום טבעי — רצפת 80g חסמה כיווץ ביום שגולש (טבעוני חיטוב).
    const minOf = it => isCracker(it) ? it.f.unitG * crackerMinN(it.f.unitG) : (it.f.unitG || 30);
    const grams = items().filter(it => it.f && !it.f.isEgg && !it.f.condiment && !it.isSaladGroup &&
      it.f.id !== 20 && it.f.id !== 21 && (!it.f.unitLabel || isCount(it)));
    const hasRoom = arr => arr.some(it => grow ? it.g < maxOf(it) : it.g > minOf(it));
    // שלב הקלוריות נוגע *רק* בפחמימות (דגן/לחם/פריכיות). חלבון בבעלות שלב 1 בלבד —
    // כך לא מנפחים חלבון מעבר ליעד כדי למלא קלוריות. אם הפחמימות מוצו → מקבלים תת-השגה קלורית.
    // תקרת דגן-בגרמים תלוית-מטרה (grainCap): חיטוב 280 / שמירה 350 / מסה 450; שיבולת שועל ≤350.
    let pool = grams.filter(it => isCarb(it) || isCount(it));
    if (!pool.length || !hasRoom(pool)) break;
    const poolCal = pool.reduce((s, it) => s + it.cal, 0) || 1;
    pool.forEach(it => {
      const targetCal = it.cal + delta * (it.cal / poolCal);
      const targetG = targetCal / it.f.cal * 100;
      if (isBread(it))        reBread(it, Math.round(targetCal / (it.f.cal * it.f.unitG / 100)));
      else if (isCracker(it)) reCracker(it, targetG);
      else if (isUnitCarb(it)) reUnit(it, Math.round(targetCal / (it.f.cal * it.f.unitG / 100)));
      else { const cap = Math.min(it._maxG || 99999, it.f.maxMeal || 99999, it.f.maxDay || 99999, grainCap(it.f));
             reG(it, Math.max(it.f.unitG || 30, Math.min(Math.round(targetG), cap))); }
    });
    meals.forEach(recalcMeal);
  }

  // פתרון אי-היתכנות: אם הקלוריות עדיין גולשות מעל הסבולת (העדפות שמנות/חלבון דליל על יעד נמוך)
  // והפחמימות מוצו — מכווצים חלבון (מנה קטנה יותר, גם אהוב — לא החלפה) עד רצפת 1.6 ג/ק"ג.
  // אם עדיין גולש → אזהרה למשתמש שלא ניתן לבנות תפריט מדויק בתנאים אלה.
  let dCalF = meals.reduce((s, m) => s + m.totCal, 0);
  if (dCalF > S.target * (1 + CAL_TOL)) {
    const prot = meals.flatMap(m => m.items).filter(it => it.f && !it.f.isEgg && !it.f.unitLabel &&
      (it.f.tags.includes('meat') || it.f.tags.includes('fish') || it.f.tags.includes('legume')));
    const protCal = prot.reduce((s, it) => s + it.cal, 0);
    const shrinkP = prot.reduce((s, it) => s + it.p, 0);
    if (prot.length && protCal > 0) {
      const protFloor = protCutFloor();   // 1.6 ג/ק"ג
      const dP = meals.reduce((s, m) => s + m.totP, 0);
      const maxRemoveP = Math.max(0, dP - protFloor);
      const floorFactor = shrinkP > 0 ? Math.max(0, 1 - maxRemoveP / shrinkP) : 1;
      const factor = Math.max(1 - (dCalF - S.target) / protCal, floorFactor);   // לא מתחת לרצפת החלבון
      prot.forEach(it => reG(it, clampG(it, Math.round(it.g * factor))));
      meals.forEach(recalcMeal);
      dCalF = meals.reduce((s, m) => s + m.totCal, 0);
    }
    if (dCalF > S.target * (1 + CAL_TOL))
      S.menuWarning = 'עם ההעדפות והיעד הנוכחיים קשה לעמוד בדיוק ביעד הקלורי, כי חלק מהמאכלים שסומנו עשירים בשומן או דלים בחלבון. ניסינו לאזן; כדי לדייק כדאי להסיר חלק מהמאכלים השמנים המועדפים או להתאים מעט את יעד הקלוריות.';
  }

  // צמצום שומן חורג ממאכלים אהובים שמנים (שלב 2 לא נוגע באהובים — כאן מקטינים *כמות* בלבד, בלי
  // החלפה שנוגדת העדפה): אם השומן חורג בגדול (>1.3× היעד) גם אחרי כל מנופי שלב 2, מכווצים את
  // החלבונים השמנים ביותר עד שהשומן מתקרב ליעד — בכפוף לרצפת חלבון יומית (~1.6 ג/ק"ג) ולרצפת המנה
  // המרכזית. הקלוריות שמתפנות ממולאות בפחמימה ע"י ה-top-up שרץ מיד אחרי (שומן↓, מקום לחלבון/פחמימה↑,
  // המאכל האהוב נשאר בצלחת). בפרופיל טהור-שומן שבו החלבון כבר על הרצפה — אין מרווח, והאזהרה תופסת.
  {
    let dF = meals.reduce((s, m) => s + (m.removed ? 0 : m.totF), 0);
    const protFloor = protCutFloor();
    if (dF > S.fatG * 1.3) {
      const fatty = items().filter(it => it.f && !it.f.isEgg && !it.f.unitLabel && !it.f.dip &&
        (it.f.tags.includes('meat') || it.f.tags.includes('fish')) && it.f.f > 5)
        .sort((a, b) => b.f.f - a.f.f);   // הכי שמן קודם
      for (const it of fatty) {
        if (dF <= S.fatG * 1.15) break;
        const dP = meals.reduce((s, m) => s + m.totP, 0);
        const roomP = dP - protFloor;                          // כמה חלבון מותר עוד להוריד
        if (roomP <= 0) break;
        const floorG = Math.max(it._minG || 0, it._mainProt ? mainProtFloor() : (it.f.unitG || 40));
        if (it.g <= floorG) continue;
        let cutG = Math.round((dF - S.fatG) / (it.f.f / 100));   // גרם להסרה כדי לקצץ את עודף השומן
        cutG = Math.min(cutG, it.g - floorG, Math.floor(roomP / (it.f.p / 100)));
        if (cutG < 20) continue;                                // קיצוץ זעיר לא שווה
        const beforeF = it.fat;
        reG(it, it.g - cutG);
        const meal = meals.find(m => m.items.includes(it)); if (meal) recalcMeal(meal);
        dF -= (beforeF - it.fat);
      }
    }
  }

  // השלמת תת-השגה (כל הלוחות): פיזור שלב-3 פרופורציונלי-לקלוריות לא תמיד ממלא את המנופים עד
  // הסוף בימים דחוקים (דיאטה מגבילה, תוספת-קטנייה, ארוחה חמה יחידה — נמדד עד ‎-33%). שלוש מדרגות,
  // כל אחת רק אם עדיין חסר: (א) דגנים גמישים קיימים עד התקרה; (ב) מנופי ספירה — לחם/פריכיות/עמילן
  // ליחידות המקסימום; (ג) הזרקת דגן גמיש לארוחה חמה שאין בה, לצד קטנייה בלי תוספת קיימת ≤250g
  // ("קטנייה + פחמימה מתונה"). הפיצול שאחרי שומר על צלחות ריאליות.
  {
    const capOf = it => Math.min(it._maxG || 99999, it.f.maxMeal || 99999, it.f.maxDay || 99999, grainCap(it.f));
    const underNow = () => S.target - meals.reduce((s, m) => s + (m.removed ? 0 : m.totCal), 0);
    let under = underNow();
    if (under > S.target * CAL_TOL) {
      const elG = items().filter(it => isElasticGrain(it.f) && it.g < capOf(it))
        .sort((a, b) => (capOf(b) - b.g) - (capOf(a) - a.g));   // הכי הרבה מקום קודם
      for (const it of elG) {
        if (under <= S.target * CAL_TOL) break;
        const addG = Math.min(capOf(it) - it.g, Math.round(under / it.f.cal * 100));
        if (addG <= 0) continue;
        const before = it.cal;
        reG(it, it.g + addG);
        under -= (it.cal - before);
      }
      meals.forEach(recalcMeal);
      under = underNow();
    }
    if (under > S.target * CAL_TOL) {
      // (ב) מנופי ספירה: מעלים יחידה-יחידה עד תקרת הריאליזם של כל פריט.
      // עמילן-יחידות לצד פחמימה נוספת באותה ארוחה מוגבל ל-2 יחידות (שהצלחת לא תיערם —
      // הפיצול שאחרי מוסיף פריט שלישי לערימות גדולות, ו-3 פריטי פחמימה בצלחת זה כבר לא ריאלי)
      const isCarbItem = x => x.f && !x.f.dip && !x.isSaladGroup &&
        (x.f.tags.includes('hot_carb') || x.f.tags.includes('grain') || x.f.tags.includes('starch'));
      for (const m of meals.filter(x => !x.removed)) {
        if (under <= S.target * CAL_TOL) break;
        for (const it of m.items) {
          if (under <= S.target * CAL_TOL) break;
          if (!it.f || !it.f.unitG || it.isSaladGroup) continue;
          const isBr = it.f.tags.includes('bread') && !it.f.tags.includes('cracker') && !it.f.pita;
          const isCr = it.f.tags.includes('cracker');
          const isSt = it.f.plural && it.f.tags.includes('starch');
          if (!isBr && !isCr && !isSt) continue;
          const otherCarb = m.items.some(x => x !== it && isCarbItem(x));
          const unitCal = it.f.cal * it.f.unitG / 100;
          const maxG = isCr ? it.f.unitG * crackerMaxN(it.f.unitG)
            : isBr ? it.f.unitG * 2
            : Math.min(it._maxG || 99999,
                Math.max(1, Math.min(otherCarb ? 2 : 3, Math.floor(450 / it.f.unitG))) * it.f.unitG);
          while (it.g + it.f.unitG <= maxG && under > S.target * CAL_TOL) {
            const n = Math.round(it.g / it.f.unitG) + 1;
            if (isCr) reCracker(it, n * it.f.unitG);
            else if (isBr) reBread(it, n);
            else reUnit(it, n);
            under -= unitCal;
          }
        }
      }
      meals.forEach(recalcMeal);
      under = underNow();
    }
    if (under > S.target * CAL_TOL) {
      // (ג) הזרקת דגן גמיש לארוחה חמה חסרת-פחמימה-גמישה (קורה כשקטנייה תפסה את התוספת)
      for (const m of meals.filter(x => !x.removed && x.type === 'hot')) {
        if (under <= S.target * CAL_TOL) break;
        const carbs = m.items.filter(it => it.f && !it.f.dip && !it.isSaladGroup &&
          (it.f.tags.includes('hot_carb') || it.f.tags.includes('grain') || it.f.tags.includes('starch')));
        const hasLeg = m.items.some(it => it.f && it.f.tags.includes('legume') && !it.f.dip);
        // קטנייה ⇒ לכל היותר פחמימה אחת לצידה; בלי קטנייה ⇒ עד 2 פריטי פחמימה
        if (m.items.some(it => it.f && isElasticGrain(it.f)) || carbs.length >= (hasLeg ? 1 : 2)) continue;
        const gr = ALL.find(f => isElasticGrain(f) && !f.tags.includes('breakfast') && allowed(f) &&
          !used.has(f.id) && !m.items.some(x => x.f && x.f.id === f.id));
        if (!gr) break;
        const cap = hasLeg ? Math.min(250, grainCap(gr)) : grainCap(gr);
        const g = Math.max(gr.unitG || 40, Math.min(cap, Math.round(under / gr.cal * 100)));
        const it = mkItem(gr, g);
        use(used, it);
        m.items.push(it);
        recalcMeal(m);
        under = underNow();
      }
    }
  }

  // נירמול פריכיות: "12 פריכיות דקות" זה מגדל, לא מנה. מעל 6 יחידות מחליפים לפריכייה בעלת
  // יחידה גדולה יותר מאותה קבוצת וריאנטים (אותם גרמים בקירוב, פחות יחידות). פריכייה אהובה
  // לא מוחלפת בסוג שלא סומן (העדפות מנצחות); used מעודכן כך שקבוצת הווריאנטים נשארת עקבית.
  meals.forEach(m => {
    if (m.removed) return;
    let changed = false;
    m.items.forEach(it => {
      if (!it.f || !it.f.tags.includes('cracker')) return;
      if (Math.round(it.g / it.f.unitG) <= 6) return;
      const alt = [45, 46, 100].map(id => ALL.find(f => f.id === id))
        .filter(f => f && f.unitG > it.f.unitG && allowed(f) &&
          (!S.liked.has(it.f.id) || S.liked.has(f.id)))
        .sort((a, b) => b.unitG - a.unitG)[0];
      if (!alt) return;
      const prev = used.get(it.f.id) || 0, left = prev - it.g;
      if (left > 0) used.set(it.f.id, left); else used.delete(it.f.id);
      it.f = alt;
      reCracker(it, it.g);   // ממיר את אותם גרמים ליחידות של הסוג הגדול (crackerPortion)
      use(used, it);
      changed = true;
    });
    if (changed) recalcMeal(m);
  });

  // פיצול "ערימת פחמימה" בארוחה חמה (דו-כיווני): הפחמימה הגמישה הכבדה ביותר — דגן בגרמים או
  // עמילן ביחידות — שעוברת ~350 קל' מתפצלת לחצי + תוספת פחמימה *מסוג אחר* (דגן→בטטה, בטטה→דגן).
  // מעבירים קלוריות 1:1 (מאקרו וקלוריות נשמרים). פותר "הר אורז" וגם "3 בטטות". פיצול אחד לארוחה.
  const SPLIT_CAL = 350;
  meals.forEach(m => {
    if (m.removed || m.type !== 'hot') return;
    // לא מפצלים פחמימה כשכבר יש קטנייה בארוחה — קטנייה עמילנית בעצמה, ופיצול היה יוצר 3 מקורות
    // פחמימה ("צלחת עמוסה": שעועית+פסטה+תפו"א). משאירים פחמימה אחת ("שעועית + פסטה").
    if (m.items.some(it => it.f && it.f.tags.includes('legume') && !it.f.dip)) return;
    // וגם: אם כבר יש 2 פריטי פחמימה בצלחת (למשל אחרי top-up) — פיצול היה מייצר שלישי. מוותרים.
    if (m.items.filter(it => it.f && !it.f.dip && !it.isSaladGroup &&
      (it.f.tags.includes('hot_carb') || it.f.tags.includes('grain') || it.f.tags.includes('starch'))).length >= 2) return;
    const isGrainItem  = it => it.f && !it.f.unitLabel && !it.f.tags.includes('breakfast') &&
      (it.f.tags.includes('grain') || it.f.tags.includes('hot_carb')) && !it.f.tags.includes('starch');
    const isStarchItem = it => it.f && it.f.plural && it.f.unitG && it.f.tags.includes('starch');
    const big = m.items.filter(it => isGrainItem(it) || isStarchItem(it)).sort((a, b) => b.cal - a.cal)[0];
    if (!big || big.cal <= SPLIT_CAL) return;
    const moveCal = big.cal * 0.5;
    if (isGrainItem(big)) {   // דגן ענק → להוסיף עמילן
      const st = ALL.find(f => f.tags.includes('starch') && f.plural && f.unitG && allowed(f) && !used.has(f.id) && !m.items.some(x => x.f && x.f.id === f.id));
      if (!st) return;
      const units = Math.max(1, Math.min(2, Math.round(moveCal / (st.cal * st.unitG / 100))));
      const sItem = mkItem(st, units * st.unitG); use(used, sItem);
      reG(big, Math.max(big.f.unitG || 30, Math.round((big.cal - sItem.cal) / big.f.cal * 100)));
      m.items.push(sItem);
    } else {                  // ערימת עמילן → להוסיף דגן ולהקטין את העמילן ביחידות
      const gr = ALL.find(f => isElasticGrain(f) && !f.tags.includes('breakfast') && allowed(f) && !used.has(f.id) && !m.items.some(x => x.f && x.f.id === f.id));
      if (!gr) return;
      const gItem = mkItem(gr, Math.max(gr.unitG || 40, Math.round(moveCal / gr.cal * 100))); use(used, gItem);
      const newUnits = Math.max(1, Math.round((big.cal - gItem.cal) / (big.f.cal * big.f.unitG / 100)));
      reUnit(big, newUnits);
      m.items.push(gItem);
    }
    recalcMeal(m);
  });
}

// ══════════════════════════════════════════
//  בניית תפריט מלא
// ══════════════════════════════════════════
// נוסח יחיד לאזהרת BMI — משמש גם בתפריט (buildMenu) וגם באזהרה החיה במסך 0 (ui.js)
// בחירת ניסוח לפי מין (זכר/נקבה) — לטקסט מגדרי דינמי. גם ui.js משתמש בזה.
function gword(m, f) { return S.gender === 'female' ? f : m; }

function bmiWarnText() {
  const bmi = S.weight / (S.height / 100) ** 2;
  if (bmi < 18.5 && S.goal !== 'bulk')   // תת-משקל: רלוונטי לחיטוב/שמירה. במסה זו דווקא המטרה הנכונה — אין אזהרה.
    return S.goal === 'cut'
      ? `ה-BMI שלך הוא ${bmi.toFixed(1)} — נמוך מהטווח הבריא (תת-משקל). חיטוב לא מומלץ במצב הזה; עדיף לשקול בניית מסה ולהתייעץ עם רופא/דיאטן.`
      : `ה-BMI שלך הוא ${bmi.toFixed(1)} — נמוך מהטווח הבריא (תת-משקל). כדאי לשקול בניית מסה ולהתייעץ עם רופא/דיאטן לפני שינוי תזונתי.`;
  if (S.goal === 'cut' && bmi < 20)
    return `ה-BMI שלך הוא ${bmi.toFixed(1)} — נמוך. חיטוב במשקל זה עלול לגרום לנזק בריאותי ולפגיעה במסת השריר. מומלץ לשקול שמירה או בניית מסה.`;
  if (S.goal === 'bulk' && bmi >= 30)
    return `ה-BMI שלך הוא ${bmi.toFixed(1)} — גבוה. בתפריט מסה עם BMI כזה מומלץ להתייעץ עם תזונאי או רופא לפני שמתחילים.`;
  return null;
}

// hard-stop: שילובי מטרה×BMI מזיקים — לא בונים תפריט, מפנים למקצוען (safety-by-design).
// חיטוב+תת-משקל (גירעון מזיק + דגל הפרעת אכילה); מסה+השמנה דרגה 2 (עודף למי שצריך לרדת;
// סף 35 ולא 30 כי BMI לא מבחין שריר/שומן וב-30–35 ייתכן ספורטאי שרירי — שם נשארת אזהרה בלבד).
function buildBlockText() {
  const bmi = S.weight / (S.height / 100) ** 2;
  if (S.goal === 'cut' && bmi < 18.5)
    return `ה-BMI שלך הוא ${bmi.toFixed(1)} — תת-משקל. במצב הזה תפריט חיטוב עלול להזיק, ולכן איננו בונים אותו. ` +
           `עדיף לשקול בניית מסה, ולהתייעץ עם רופא או דיאטן. 🩺`;
  if (S.goal === 'bulk' && bmi >= 35)
    return `ה-BMI שלך הוא ${bmi.toFixed(1)} — גבוה. במצב הזה תפריט עודף קלורי (מסה) אינו מומלץ, ולכן איננו בונים אותו. ` +
           `מומלץ לשקול מטרת שמירה או חיטוב, ולהתייעץ עם רופא או דיאטן. 🩺`;
  return null;
}

// טיפים קלילים (לא ייעוץ קליני) — לפי דיאטה; מוצגים בתחתית התפריט
function dietTips() {
  const tips = [];
  if (S.diet.has('vegan')) {
    tips.push('🌱 בתזונה טבעונית כדאי לוודא מקור קבוע ל-B12.');
    tips.push('🥣 תפריט טבעוני עשיר מאוד בסיבים. עלייה הדרגתית ושתייה מרובה יקלו על ההסתגלות.');
  }
  tips.push('💧 הקפידו על שתייה מרובה של מים במהלך היום.');
  return tips;
}

// אזהרת מסה-בלי-אימון: עודף קלורי ללא אימוני כוח נאגר כשומן, לא כשריר. מקור יחיד (תפריט + מסך 1).
function trainWarnText() {
  if (S.goal === 'bulk' && S.noTrain)   // רק כשנבחר מפורשות "לא מתאמן כרגע" (לא סתם כשטרם נבחר זמן)
    return `מסה בלי אימון לא עובדת: עודף קלורי ללא אימוני כוח נאגר כשומן, לא כשריר. אם אינך ${gword('מתאמן, בחר', 'מתאמנת, בחרי')} יעד "שמירה". תוכנית מסה מתאימה רק עם אימוני התנגדות.`;
  return null;
}

function buildMenu() {
  calcMacro();
  S.bmiWarning = bmiWarnText();
  S.trainWarning = trainWarnText();

  S.menuWarning = null;

  // פינוק מתוכנן: מקצים את התקציב שלו מראש — התפריט נבנה ומיושר סביב מה שנשאר.
  // calcMacro רץ בכל בנייה, אז ההפחתה כאן זמנית מטבעה (משוחזר בסוף הפונקציה לתצוגה).
  const fullTarget = S.target;
  let treatMeal = null, treatWarn = null;
  if (S.treats && S.treats.length) {
    const items = S.treats.map(id => TREATS.find(x => x.id === id)).filter(Boolean).map(tf => mkItem(tf, tf.unitG));
    if (items.length) {
      const tCal  = items.reduce((s, it) => s + it.cal, 0);
      const tFat  = items.reduce((s, it) => s + it.fat, 0);
      const tCarb = items.reduce((s, it) => s + it.c, 0);
      const tName = items.length === 1 ? items[0].f.name : `${items.length} פינוקים`;
      const reduced = S.target - tCal;
      if (tCal > 0 && reduced < 800) {
        // הפינוק גדול מכדי להיכנס ביעד: לא בונים יום מתחת ל-800 קק"ל (safety) — מתריעים על החריגה
        treatWarn = `הגזמנו קצת 🙂 הפינוק שבחרת (${tName}, ${tCal} קק"ל) גדול ביחס ליעד היומי — גם עם ארוחות מינימליות היום יחרוג בכ-${800 + tCal - S.target} קק"ל. אפשר לבחור פינוק קטן יותר, או ליהנות היום ולחזור למסלול מחר.`;
      } else if (tCal > S.target * 0.25) {
        treatWarn = `${gword('שים', 'שימי')} לב: הפינוק תופס כ-${Math.round(tCal / S.target * 100)}% מהיעד היומי — שאר הארוחות קוצצו בהתאם.`;
      }
      S.target  = Math.max(800, reduced);
      S.fatG    = Math.max(20, S.fatG - Math.round(tFat));
      S.carbG   = Math.max(50, S.carbG - Math.round(tCarb));
      treatMeal = { label: 'פינוק', icon: 'gift', time: '', pct: 0, tag: null, type: 'treat', big: false, items };
      recalcMeal(treatMeal);
    }
  }

  const t = S.target;
  const key = (S.noTrain || !S.time) ? 'noTrain' : S.time;
  const mealDefs = mealPlan(key, t);
  const used = new Map();
  const ctx = { usedCarbCats: new Set() }; // גיוון קטגוריות פחמימה לאורך היום

  // בונים קודם את הארוחות הפחות-גמישות (לא-חמות, יחידות טבעיות), ואז את החמות (בשר+פחמימה
  // בגרמים) לפי התקציב שנותר — כך הגמישות מכוונת ישר ליעד היומי. הסדר לתצוגה נשמר.
  const meals = mealDefs.map(def => ({ ...def, budget: Math.round(t * def.pct), items: [] }));

  // כשרות — הפרדת 6 שעות בשר→חלב: ארוחה חלבית לא תיפול בחלון של עד 6ש' *אחרי* ארוחה בשרית.
  // חל רק על כשר+אוכל-כול (לצמחוני/טבעוני אין בשר → חלב חופשי). הארוחה הבשרית = ה-hot (בשר/דג;
  // מתייחסים אליה כבשרית באופן שמרני). מחושב על מערך meals הסופי — כולל נשנושי מסה שנוספו ב-mealPlan.
  // הכיוון ההפוך (חלבי→בשרי) דורש הלכתית רק הדחה, ומרווחי הלוח מספיקים — לכן אינו מוגבל.
  const kMeatSep = S.diet.has('kosher') && !S.diet.has('vegetarian') && !S.diet.has('vegan');
  if (kMeatSep) {
    const mins = tm => { const [h, m] = String(tm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const meatMins = meals.filter(m => m.type === 'hot').map(m => mins(m.time));
    meals.forEach(m => { if (m.type !== 'hot') m.noDairy = meatMins.some(ht => { const d = mins(m.time) - ht; return d > 0 && d <= 360; }); });
    S.kosherSep = meals.some(m => m.noDairy);   // דגל לתצוגת הערת המידע
  } else S.kosherSep = false;

  const buildInto = (m, budget) => { m.budget = budget; m.items = buildMealBest(m.type, budget, used, { ...ctx, noDairy: m.noDairy }); recalcMeal(m); };

  meals.filter(m => m.type !== 'hot').forEach(m => buildInto(m, m.budget));
  const hot = meals.filter(m => m.type === 'hot');
  const usedCal = meals.filter(m => m.type !== 'hot').reduce((s, m) => s + m.totCal, 0);
  const remaining = Math.max(0, t - usedCal);
  const hotPctSum = hot.reduce((s, m) => s + m.pct, 0) || 1;
  hot.forEach(m => buildInto(m, Math.round(remaining * m.pct / hotPctSum)));

  // ערובת פרי: אם לא נכנס אף פרי ליום והקלוריות מאפשרות — מוסיפים לנשנוש (או לאחרונה)
  const fruitIds = new Set(ALL.filter(f => f.tags.includes('fruit')).map(f => f.id));
  const hasFruit = [...used.keys()].some(id => fruitIds.has(id));
  if (!hasFruit && S.target > 1200) {
    const snackIdx = meals.findIndex(m => m.type === 'snack');
    const idx = snackIdx >= 0 ? snackIdx : meals.length - 1;
    const fr = pick(ALL.filter(f => f.tags.includes('fruit')), used, 120, 0, 250);
    if (fr) {
      use(used, fr);
      meals[idx].items.push(fr);
      recalcMeal(meals[idx]);
    }
  }

  reconcile(meals, used, ctx);   // יישור מאקרו ליעד (מול היעד המוקטן אם יש פינוק)

  // שקיפות: נשארנו רחוקים מהיעד (>8%) גם אחרי כל המנופים — אומרים זאת ביושר (לא מסתירים סטייה)
  const finCal = meals.reduce((s, m) => s + (m.removed ? 0 : m.totCal), 0);
  const finDev = (finCal - S.target) / Math.max(S.target, 1);
  if (!S.menuWarning && Math.abs(finDev) > 0.08)
    S.menuWarning = finDev < 0
      ? `עם ההעדפות וההגבלות שנבחרו הצלחנו להגיע עד כ-${Math.round(Math.abs(finDev) * 100)}% מתחת ליעד הקלורי. התפריט מאוזן — פשוט קשה למלא את היעד עם המבחר הנוכחי; סימון עוד מאכלים (במיוחד פחמימות) יעזור לדייק.`
      : `עם ההעדפות שנבחרו התפריט חורג בכ-${Math.round(finDev * 100)}% מעל היעד הקלורי — חלק מהמאכלים המסומנים עשירים בקלוריות ביחס לחלבון. הסרת חלק מהם תעזור לדייק.`;
  // שקיפות חלבון: כשאין יעד קוהרנטי להזרקה (שער הטעם) לא מזריקים בכוח — והחלבון נשאר חסר.
  // תוכנית 06/08 קבעה שהחוסר הזה "ידווח ביושר", אבל עד 07/08 לא היה טריגר חלבון בכלל,
  // ולכן תפריט שנחת מדויק בקלוריות ו-40% מתחת בחלבון יצא שקט לגמרי (נמדד: 91/1440, 77 בלי אזהרה).
  // הסף הוא אחוזי ולא ג/ק"ג: S.proteinG כבר מקודד את היעד הנכון לכל דיאטה (2 / 1.6 לטבעוני-ולא-מתאמן /
  // פרוקסי גוף-רזה מעל BMI 30), ורף ג/ק"ג אחיד היה צועק על כל תפריט טבעוני שנוחת על היעד שנקבע לו.
  const finProt = meals.reduce((s, m) => s + (m.removed ? 0 : m.totP), 0);
  const protDev = S.proteinG ? (finProt - S.proteinG) / S.proteinG : 0;
  // מתריעים מול הרצפה המנחה, לא מול היעד. היעד (2 למתאמן, 1.6 ללא-מתאמן ≈ פי 2 מה-RDA)
  // שאפתני ומגובה, אבל החמצה שלו אינה כשל תזונתי: בגירעון ההמלצה ליושבני היא 1.0-1.2 ג/ק"ג
  // ולמתאמן 1.6-2.2. סף אחוזי לבדו התריע על 84 תפריטים שמתוכם 63 נחתו על 1.6-1.79 — תקינים לגמרי.
  // אצל מתאמן נדרש *גם* פער מהיעד האישי, אחרת טבעוני שנחת על היעד שלו (1.6, המקסימום המעשי
  // מהצומח) היה מקבל אזהרה חסרת פשר ב-141 תפריטים.
  const protPerKg = finProt / Math.max(S.protRefW || S.weight, 1);
  const protLow = S.noTrain ? protPerKg < 1.0 : (protPerKg < 1.6 && protDev < -0.15);
  if (!S.menuWarning && protLow)
    S.menuWarning = `התפריט מגיע לכ-${Math.round(finProt)}g חלבון מול יעד של ${S.proteinG}g. עם ההעדפות וההגבלות שנבחרו קשה להגיע ליעד בלי לשבש את הארוחות; סימון עוד מקורות חלבון יעזור לצמצם את הפער.`;
  // שקיפות שומן: מאכלים אהובים שמנים לא מוחלפים (העדפות מנצחות) — אבל לא מסתירים את המחיר
  const finFat = meals.reduce((s, m) => s + (m.removed ? 0 : m.totF), 0);
  if (!S.menuWarning && finFat > S.fatG * 1.5)
    S.menuWarning = `שומן יומי של כ-${Math.round(finFat)}g מול יעד של ${S.fatG}g — חלק מהמאכלים שסומנו כאהובים עשירים בשומן, והם נשארים בתפריט לפי ההעדפה. החלפת חלק מהם בחלופות רזות תאזן את התפריט.`;

  S.target = fullTarget;                    // שחזור היעד המלא לתצוגה ולפס ההתקדמות
  if (treatMeal) meals.push(treatMeal);     // הפינוק מוצג ככרטיס משלו, מחוץ ל-reconcile
  if (treatWarn) S.menuWarning = treatWarn; // אזהרת פינוק גוברת על אזהרות כלליות — היא הסיבה הישירה
  return meals;
}

// ══════════════════════════════════════════
//  "אכלתי משהו אחר" — בנייה מחדש של המשך היום סביב מה שנאכל בפועל
// ══════════════════════════════════════════
// פריט ידני (שם חופשי + קלוריות): מאקרו משוער שמרני-לחלבון — p=0, ‎60% פחמימה / 40% שומן.
function manualItem(name, cal) {
  cal = Math.max(0, Math.round(cal));
  return { f: { id: -1, name, prep: '', tags: [] }, g: 0, dispG: '', displayName: name,
           cal, p: 0, c: Math.round(cal * 0.6 / 4), fat: Math.round(cal * 0.4 / 9), fib: 0 };
}

// מחליף את תוכן הארוחה mealIdx בפריטים שנאכלו בפועל (אחד או יותר), נועל את הנאכלות,
// ובונה מחדש את הפתוחות מול היעדים שנותרו (rebalanceDay).
// markEaten=false: הארוחה ננעלת בלי להיחשב כנאכלה. נדרש ל"אזן את ההמשך" אחרי
// עריכה — קודם הוא סימן אותה כנאכלה רק כדי לנעול אותה, וזה זייף למשתמשת את פס
// ההתקדמות *וגם* נשלח למאמנת כארוחה שסומנה. (דווח 08/08/2026)
function rebuildRest(meals, eaten, mealIdx, actualItems, opts) {
  const meal = meals[mealIdx];
  meal.items = Array.isArray(actualItems) ? actualItems : [actualItems];
  meal.removed = false;
  recalcMeal(meal);
  if (opts && opts.markEaten === false) meal.edited = true;   // נעילה בלי "נאכלה"
  else eaten[mealIdx] = true;
  return rebalanceDay(meals, eaten);
}

// בונה מחדש את הארוחות הפתוחות סביב הנעולות (נאכלו / פינוק) מול היעדים שנותרו.
// שלוש מדרגות: בנייה רגילה / נשנוש קל / חצה את היעד. משמש גם את "אכלתי משהו אחר"
// וגם הוספת/הסרת פינוק באמצע יום (בלי לאפס סימונים).
// משנה את meals/eaten במקום; מחזיר { note, partialWarn } להצגה.
function rebalanceDay(meals, eaten) {
  // פינוק מתוכנן שטרם נאכל שומר על מקומו (תקציבו שמור) — נספר כ"נעול".
  // 🔑 וגם ארוחה שהמשתמשת ערכה ידנית (m.edited): היא הביעה כוונה מפורשת לגביה,
  // והמנוע לא רשאי לבנות אותה מחדש. בלי זה, עריכה בארוחה אחת נמחקה ברגע
  // שנגעו בארוחה אחרת ולחצו איזון — אובדן נתונים שקט. (דווח 08/08/2026)
  const isLockedIdx = i => eaten[i] || meals[i].type === 'treat' || meals[i].edited;
  const open = meals.map((m, i) => ({ m, i })).filter(x => !isLockedIdx(x.i) && !x.m.removed);
  const lockedMeals = meals.filter((m, i) => isLockedIdx(i) && !m.removed);
  const isWorkout = x => !!x.m.tag;   // ארוחת לפני/אחרי אימון — מוגנת: לא נמחקת ולא מאבדת את החלבון

  const sum = sel => lockedMeals.reduce((s, m) => s + (m[sel] || 0), 0);
  const tR = S.target - sum('totCal');

  // used מהפריטים הנעולים — כדי שהבנייה מחדש לא תחזור על אותם מאכלים
  const used = new Map();
  lockedMeals.forEach(m => m.items.forEach(it => {
    if (it.isSaladGroup) (it._comps || []).forEach(c => c.f && used.set(c.f.id, (used.get(c.f.id) || 0) + c.g));
    else if (it.f && it.f.id > 0) used.set(it.f.id, (used.get(it.f.id) || 0) + it.g);
  }));
  const ctx = { usedCarbCats: new Set() };

  // נשנוש חלבון לארוחת אימון מוגנת: תבנית snack, ואם יצאה דלת-חלבון — חלבון ישיר
  // (גבינה/יוגורט/ביצה/בשר/דג/קטנייה — מכסה גם טבעונים וגם ימים שבהם החלב כבר נוצל)
  const proteinSnack = budget => {
    let items = buildMealBest('snack', budget, used, ctx);
    if (items.reduce((s, it) => s + (it.p || 0), 0) < 8) {
      const pool = ALL.filter(f => isCheese(f) || isYogurt(f) || f.tags.includes('egg') ||
        f.tags.includes('meat') || f.tags.includes('fish') || (f.tags.includes('legume') && !f.dip));
      const pr = pick(pool, used, budget, 12, 250);
      if (pr) { use(used, pr); items = [pr]; }
    }
    return items;
  };

  // מדרגה 3: חצה את היעד היומי — מסירים את הארוחות הפתוחות, בלי "ארוחות עונשין".
  // חריג: ארוחות אימון נשארות כנשנוש חלבון קל — שימור שריר גובר על חריגה קלורית קטנה.
  if (tR <= 0) {
    let keptWorkout = false;
    open.forEach(x => {
      if (isWorkout(x)) {
        x.m.items = proteinSnack(180);
        recalcMeal(x.m);
        keptWorkout = true;
      } else {
        x.m.removed = true; x.m.items = []; recalcMeal(x.m);
      }
    });
    return {
      note: keptWorkout
        ? `חצית את היעד היומי (+${Math.abs(Math.round(tR))} קק"ל). זה קורה — ובכל זאת השארנו ארוחת חלבון קלה סביב האימון: עליה לא מוותרים 💪 מחר מתחילים דף חדש.`
        : `חצית את היעד היומי (+${Math.abs(Math.round(tR))} קק"ל). זה קורה — מחר מתחילים דף חדש 💪 אם רעבים: ירקות חופשיים ומים.`,
      partialWarn: null,
    };
  }

  // מדרגה 2: יתרה קטנה — נשארות רק ארוחות האימון (עם חלבון), או נשנוש קל אחד אם אין אימון
  if (tR < 300) {
    const keepers = open.filter(isWorkout).length ? open.filter(isWorkout) : open.slice(0, 1);
    const each = Math.max(Math.round(tR / keepers.length), 120);
    open.forEach(x => {
      if (keepers.includes(x)) {
        x.m.items = isWorkout(x) ? proteinSnack(each) : buildMealBest('snack', each, used, ctx);
        if (!isWorkout(x)) x.m.label = 'נשנוש קל';
        recalcMeal(x.m);
      } else {
        x.m.removed = true; x.m.items = []; recalcMeal(x.m);
      }
    });
    return {
      note: keepers.some(isWorkout)
        ? 'היום כמעט מלא, השארנו ארוחת חלבון קלה סביב האימון. מחר חוזרים למסלול 💪'
        : 'היום כמעט מלא, השארנו לך ארוחה קלה להמשך. מחר חוזרים למסלול 💪',
      partialWarn: null,
    };
  }

  // מדרגה 1: בנייה מחדש מלאה של ההמשך מול היעדים שנותרו (אותו מנוע: buildMealBest + reconcile)
  const saved = { target: S.target, proteinG: S.proteinG, fatG: S.fatG, carbG: S.carbG, menuWarning: S.menuWarning };
  let partialWarn = null;
  try {
    S.target   = tR;
    S.proteinG = Math.max(10, S.proteinG - Math.round(sum('totP')));
    S.fatG     = Math.max(10, S.fatG - Math.round(sum('totF')));
    S.carbG    = Math.max(20, S.carbG - Math.round(sum('totC')));
    S.menuWarning = null;

    const openMeals = open.map(x => x.m);

    // התאמת מספר הארוחות ליתרה (דו-כיווני, אותו עיקרון כמו mealPlan):
    // יתרה גדולה → נשנושים נוספים (לא לנפח מנות); יתרה קטנה → מורידים ארוחות מהסוף
    // (לארוחה יש גודל מינימלי). ארוחות אימון (tag) לעולם לא מוסרות.
    while (openMeals.length > 1 && tR / openMeals.length < 260) {
      let di = openMeals.length - 1;
      while (di >= 0 && openMeals[di].tag) di--;   // מאתרים את האחרונה שאינה ארוחת אימון
      if (di < 0) break;                            // נשארו רק ארוחות אימון — לא נוגעים
      const drop = openMeals.splice(di, 1)[0];
      drop.removed = true; drop.items = []; recalcMeal(drop);
    }
    const perMeal = tR / Math.max(openMeals.length, 1);
    let extra = perMeal > 800 ? 3 : perMeal > 600 ? 2 : perMeal > 450 ? 1 : 0;
    extra = Math.min(extra, 6 - openMeals.length);   // לא יותר מ-6 ארוחות פתוחות
    for (let k = 0; k < extra; k++) {
      // added:true => ארוחה שנוצרה אגב איזון אמצע-יום (לא חלק מתפריט הבסיס); מנוקה ביום חדש (loadDay)
      const nm = { label: 'נשנוש נוסף', icon: 'coffee', time: '', pct: 0.15, tag: null, type: 'snack', big: false, items: [], added: true };
      meals.push(nm);
      eaten.push(false);
      openMeals.push(nm);
    }

    const pctSum = openMeals.reduce((s, m) => s + (m.pct || 0), 0) || openMeals.length;
    const shareOf = m => (m.pct || pctSum / openMeals.length) / pctSum;

    openMeals.filter(m => m.type !== 'hot').forEach(m => {
      m.items = buildMealBest(m.type, Math.round(tR * shareOf(m)), used, ctx);
      recalcMeal(m);
    });
    const hotOpen = openMeals.filter(m => m.type === 'hot');
    const usedCal = openMeals.filter(m => m.type !== 'hot').reduce((s, m) => s + m.totCal, 0);
    const remaining = Math.max(0, tR - usedCal);
    const hotPct = hotOpen.reduce((s, m) => s + (m.pct || 0), 0) || 1;
    hotOpen.forEach(m => {
      m.items = buildMealBest(m.type, Math.round(remaining * (m.pct || 1) / hotPct), used, ctx);
      recalcMeal(m);
    });

    reconcile(openMeals);
    partialWarn = S.menuWarning;
  } finally {
    Object.assign(S, saved);
  }

  // אזהרת אי-ההתאמה הכללית מנוסחת לבניית תפריט מלא ("הסר מאכלים מועדפים...") — באמצע יום
  // הסיבה האמיתית היא יתרה צפופה. מחליפים בהודעה הקשרית עם החריגה הצפויה במספרים.
  if (partialWarn) {
    const total = meals.filter(m => !m.removed).reduce((s, m) => s + m.totCal, 0);
    const over = total - S.target;
    partialWarn = over > S.target * 0.04
      ? `${gword('שים', 'שימי')} לב: אחרי העדכון נשארה יתרה צפופה, והיום צפוי לחרוג בכ-${Math.round(over)} קק"ל מהיעד. זה בסדר — מחר חוזרים למסלול 💪`
      : null;   // בפועל בטווח — אין צורך באזהרה
  }

  return {
    note: 'ההמשך עודכן סביב מה שאכלת ✓. השינוי תקף להיום בלבד; מחר חוזרים לתפריט הרגיל.',
    partialWarn,
  };
}

// תבנית ארוחות לפי זמן אימון + תוספת נשנושים ליעד קלורי גבוה (מסה) — כדי לפזר את התקציב
// על יותר ארוחות ולא לדחוס מנות ענק (מפתחי גוף אוכלים 5–6 ארוחות).
function mealPlan(key, target) {
  const defs = MEAL_TIMES[key].map(d => ({ ...d }));
  let extra = target > 2900 ? 3 : target > 2400 ? 2 : target > 2100 ? 1 : 0;   // ספים הונמכו כשהלחם הוגבל ל-2 פרוסות
  // ארוחה חמה יחידה (בוקר/ללא-אימון) עם יעד גבוה: נשנוש נוסף, כדי שהמנה החמה היחידה לא תישא
  // ~50% מהיום (קורה בעיקר בדיאטה מגבילה שבה שאר הארוחות לא מתמלאות). מפזר לארוחות סבירות יותר.
  if ((key === 'noTrain' || key === 'morning') && target > 2200) extra += 1;
  const slots = [{ time: '10:30' }, { time: '16:00' }, { time: '21:30' }, { time: '14:30' }];
  for (let i = 0; i < extra && i < slots.length; i++)
    defs.push({ label: 'נשנוש נוסף', icon: 'coffee', time: slots[i].time, pct: 0.13, tag: null, type: 'snack', big: false });
  defs.sort((a, b) => a.time.localeCompare(b.time));
  const sum = defs.reduce((s, d) => s + d.pct, 0) || 1;
  defs.forEach(d => d.pct /= sum);
  return defs;
}
