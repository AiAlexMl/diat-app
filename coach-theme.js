/* ══════════════════════════════════════════
   coach-theme.js — מיתוג מאמן (white-label)
   נטען ראשון (לפני data/app/ui) כדי להחיל צבעים מוקדם.
   מקור המיתוג (שלב 2, 09/08/2026): **coaches_public ב-Supabase** — מקור אמת אחד,
   מאמנת נוצרת פעם אחת ב-Studio. coaches.json נשאר כ-fallback בלבד, ומטמון
   מקומי (shapeat-coach-brand) צובע מיד בביקור חוזר.
   עקרונות: כל כשל ⇒ ברירת המחדל של ShapEat; שם/סלוגן רק דרך textContent (XSS);
   צבע עובר סף ניגודיות מול טקסט לבן; שורת "מופעל ע"י ShapEat" קבועה (מיגון משפטי).
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const KEY = 'shapeat-coach';
  const CACHE_KEY = 'shapeat-coach-brand';               // מטמון המיתוג, לצביעה מיידית בביקור חוזר
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;   // ASCII בלבד, כמו ה-check ב-DB
  const HEX_RE  = /^#[0-9a-fA-F]{6}$/;

  // ── ההחלה המאוחרת מוגדרת כאן, לפני כל יציאה מוקדמת ──
  // הצביעה בטעינה קורית פעם אחת, ולכן מי שמתגלה אחר כך נשארת בלי מיתוג עד רענון:
  // מתאמנת שאישרה הסכמה מלינק בלי ?coach=, או מי שכבר מקושרת בדאטהבייס אבל
  // הדפדפן הזה לא יודע. supabase-client קורא לזה כשהוא מגלה מאמן/ת.
  // ⚠️ **חייב להיות מעל `if (!slug) return`** — מי שאין לו מיתוג שמור הוא בדיוק
  //    מי שההחלה האוטומטית נועדה לו, וההגדרה מתחת ליציאה הותירה אותו בלי הפונקציה
  //    (ה-catch בצד הקורא בלע את ה-TypeError, ולכן הכשל היה שקט לגמרי). 10/08/2026
  window.shapeatApplyCoach = function (c) {
    if (!c || !c.slug || !SLUG_RE.test(c.slug)) return;
    try {
      localStorage.setItem(KEY, c.slug);
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
    apply(c);
  };

  // ── שלב א: מי המאמן? פרמטר ב-URL גובר; אחרת מה שנשמר מביקור קודם ──
  let slug = null;
  try {
    const param = new URLSearchParams(location.search).get('coach');
    if (param !== null) {
      const s = param.trim().toLowerCase();
      if (SLUG_RE.test(s)) { slug = s; localStorage.setItem(KEY, s); }
      else { localStorage.removeItem(KEY);        // ?coach= ריק/שגוי = הסרת מיתוג מפורשת
             localStorage.removeItem(CACHE_KEY); }   // גם המטמון, אחרת נשארת שארית
    } else {
      slug = localStorage.getItem(KEY);
      if (slug && !SLUG_RE.test(slug)) { slug = null; localStorage.removeItem(KEY); }
    }
  } catch (e) { slug = null; }                    // localStorage חסום — בלי מיתוג

  if (!slug) return;

  // ── ניגודיות: מכהים את צבע המאמן עד שטקסט לבן עליו עומד ב-4.5:1 (WCAG AA) ──
  function relLum(hex) {
    const c = [1, 3, 5].map(i => {
      let v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ensureContrast(hex) {
    let rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    for (let i = 0; i < 12; i++) {
      const h = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
      if (1.05 / (relLum(h) + 0.05) >= 4.5) return h;   // ניגודיות מול לבן
      rgb = rgb.map(v => Math.floor(v * 0.85));          // כהה יותר ב-15%
    }
    return '#4f46e5';                                    // לא הצליח — צבע הבית
  }

  // ── שלב ב: טעינת המיתוג והחלה ──
  // ── מקור המיתוג (שלב 2) ──
  // הדאטהבייס הוא מקור האמת: מאמנת נוצרת פעם אחת ב-Studio וזהו. coaches.json
  // נשאר כרשת ביטחון בלבד, למקרה ש-Supabase לא זמין.
  // ⚠️ אין כאן SDK — הוא נטען אחרינו. coaches_public פתוח ל-anon, ולכן די ב-fetch
  //    רגיל ל-REST עם המפתח הציבורי.
  // המטמון המקומי קיים כדי שביקור חוזר יהיה ממותג מיד: בקשת רשת לפני הצביעה
  // הראשונה יוצרת הבזק של מותג הבית, ורק הביקור הראשון חשוף לו.
  const SUPA_URL  = 'https://kjlxgamalfzdjtjxfzun.supabase.co';
  const SUPA_ANON = 'sb_publishable_cUbB5SU30DWzSdFmP2T24w_lc4PjF9f';

  try {                                          // מטמון: מיתוג מיידי, בלי המתנה לרשת
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.slug === slug) apply(cached);
  } catch (e) {}

  const fromDb = fetch(SUPA_URL + '/rest/v1/coaches_public?select=*&slug=eq.' +
      encodeURIComponent(slug), { headers: { apikey: SUPA_ANON, Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
    .then(rows => {
      const c = Array.isArray(rows) && rows[0];
      if (!c) return Promise.reject(new Error('not in db'));
      // שמות העמודות ב-DB שונים משמות המפתחות ב-coaches.json — ממפים לצורה אחת
      return { slug: c.slug, name: c.display_name, tagline: c.tagline,
               color: c.brand_color, color2: null, logo: c.logo_path || null };
    });

  fromDb
    .catch(() =>                                   // Supabase לא זמין — נופלים לקובץ
      fetch('coaches.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
        .then(list => {
          const c = Array.isArray(list) ? list.find(x => x && x.slug === slug) : null;
          return c || Promise.reject(new Error('not in json'));
        }))
    .then(c => {
      apply(c);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
    })
    .catch(err => {
      // "לא נמצא בשום מקום" = המאמנת ירדה ⇒ מסירים את השיוך. כשל רשת ⇒ משאירים
      // אותו (offline-first): המטמון כבר צבע, ובפעם הבאה ננסה שוב.
      if (String(err.message).indexOf('not in') === 0) {
        try { localStorage.removeItem(KEY); localStorage.removeItem(CACHE_KEY); } catch (e) {}
      }
    });

  function apply(c) {
    // צבעים — מיד (לפני רינדור), רק אחרי ולידציה וסף ניגודיות
    const root = document.documentElement;
    root.classList.add('coach-branded');   // מסתיר את ה-CTA "מאמן/ה?" — לא מגייסים מאמנים על גב מתאמנים של מאמן
    if (HEX_RE.test(c.color || '')) {
      const main = ensureContrast(c.color);
      root.style.setProperty('--accent', main);
      root.style.setProperty('--accent-2', HEX_RE.test(c.color2 || '') ? ensureContrast(c.color2) : main);
      root.style.setProperty('--text-info', main);
    }

    // DOM — אחרי שה-header קיים
    const onReady = fn => document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', fn) : fn();
    onReady(() => {
      const img   = document.querySelector('.logo-img');
      const text  = document.querySelector('.logo-text');
      const tag   = document.querySelector('.logo-tag');
      const stack = document.querySelector('.logo-stack');
      if (!img || !text || !stack) return;

      const name = typeof c.name === 'string' ? c.name.slice(0, 40).trim() : '';

      if (typeof c.logo === 'string' && /^brand\/coaches\/[\w.-]+\.(png|webp|jpg)$/.test(c.logo)) {
        img.src = c.logo;                          // נתיב מוגבל לתיקיית הלוגואים בלבד
        if (name) img.alt = name;
      } else {                                     // אין לוגו — מונוגרמה בצבעי המאמן
        const mono = document.createElement('div');
        mono.className = 'coach-monogram';
        mono.textContent = name ? name.charAt(0) : 'S';
        img.replaceWith(mono);
      }

      if (name) text.textContent = name;           // textContent בלבד — לא innerHTML
      if (tag && typeof c.tagline === 'string' && c.tagline.trim())
        tag.textContent = c.tagline.slice(0, 80).trim();

      // מיגון משפטי — שורה קבועה, לא ניתנת להסרה דרך coaches.json.
      // יושבת ב-footer עם שאר האותיות הקטנות; אם ה-footer חסר — נופלת חזרה מתחת ללוגו,
      // כדי שהשורה תמיד תופיע איפשהו בעמוד ממותג.
      const pb = document.createElement('div');
      pb.className = 'coach-powered';
      const ic = document.createElement('img');
      ic.src = 'brand/AVATAR-shapeat.png';
      ic.alt = '';                               // דקורטיבי — הטקסט אומר ShapEat
      ic.className = 'coach-powered-logo';
      pb.appendChild(ic);
      pb.appendChild(document.createTextNode('מופעל ע"י ShapEat · תפריט לדוגמה מחושב אוטומטית'));
      const footer = document.querySelector('.site-footer');
      if (footer) footer.insertBefore(pb, footer.firstChild);
      else stack.appendChild(pb);
    });
  }

})();
