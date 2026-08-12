/* ══════════════════════════════════════════
   supabase-client.js — שלב 1: חשבון, היסטוריה, סנכרון (offline-first)
   נטען defer אחרי ui.js. עוטף פונקציות קיימות דרך window — אפס נגיעה בקוד קיים.
   עקרון-העל: localStorage תמיד ראשון וסינכרוני; הענן מראה משנית.
   אנונימי / בלי קונפיג / Supabase נפל ⇒ האפליקציה זהה להיום בייט-לבייט.
   מקור: internal/ARCHITECTURE-COACHES.md (המסמך המחייב).
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  // ── קונפיג: ה-anon key ציבורי במתכוון (RLS הוא ההגנה). ריק ⇒ השכבה לא רצה ──
  const SUPA_URL  = 'https://kjlxgamalfzdjtjxfzun.supabase.co';
  const SUPA_ANON = 'sb_publishable_cUbB5SU30DWzSdFmP2T24w_lc4PjF9f';

  if (!SUPA_URL || !SUPA_ANON || !window.supabase) return;

  const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON);

  const STATE_KEY = 'dietai-state';
  const DAY_KEY   = 'shapeat-day';
  const META_KEY  = 'shapeat-sync-meta';      // { prefs: iso, day: iso } — שעון לקוח ל-LWW
  const FAV_KEY   = 'shapeat-favorites';      // מקור התצוגה תמיד מקומי; הענן מתמזג פנימה

  const nowIso = () => new Date().toISOString();
  const newer  = (a, b) => Date.parse(a) > Date.parse(b);   // השוואת זמנים בטוחה (פורמטים שונים)
  const parse  = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  const lsGet  = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet  = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  let session = null;
  // אנונימי לחץ "שמור" → נשמור מיד אחרי התחברות. חייב לשרוד redirect (Google/magic-link)
  // ולכן ב-localStorage, עם חלון זמן שמונע שמירת יום אחר אם ההתחברות קורית הרבה אחר כך.
  const FAV_INTENT_KEY = 'shapeat-fav-intent';
  const FAV_INTENT_MS  = 30 * 60 * 1000;
  const WEIGHT_KEY = 'shapeat-weights';        // מקור התצוגה תמיד מקומי; הענן מתמזג פנימה (כמו מועדפים)
  const UW_KEY     = 'shapeat-uw-alerted';     // דגל "כבר הופנה באפיזודת תת-משקל הנוכחית"
  const meta  = parse(lsGet(META_KEY)) || {};
  const dirty = { prefs: false, day: false, favs: false, weight: false };
  let pushTimer = null;
  // outbox למועדפים: אילו fav_id ממתינים לעלייה/מחיקה. caveat מתועד: מחיקה offline
  // שלא הגיעה לשרת (הטאב נסגר לפני retry) תקום לתחייה מהענן ב-pull הבא — מקובל ל-v1.
  const pendingFavUpserts = new Set();
  const pendingFavDeletes = new Set();
  const pendingWeightUpserts = new Set();      // תאריכי שקילות שממתינים לעלייה
  const pendingWeightDeletes = new Set();

  const saveMeta = () => lsSet(META_KEY, JSON.stringify(meta));

  // ══════════ אנליטיקס פנימי (events, אנונימי, insert-only) ══════════
  let evtCount = 0;                            // throttle בלקוח
  function anonId() {
    let id = lsGet('shapeat-anon');
    if (!id) { id = crypto.randomUUID(); lsSet('shapeat-anon', id); }
    return id;
  }
  function track(type, props) {
    if (evtCount++ > 30) return;               // תקרת אירועים לסשן
    try {
      sb.from('events').insert({
        event_type: type, anon_id: anonId(),
        coach_slug: lsGet('shapeat-coach') || null,
        props: props || null,
      }).then(() => {}, () => {});
    } catch (e) {}
  }

  // ══════════ Push: outbox debounced — snapshot מלא, upsert אידמפוטנטי ══════════
  function markDirty(kind) {
    meta[kind] = nowIso(); saveMeta();
    dirty[kind] = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 2000);        // דחיפה אחרי 2 שניות שקט
  }

  async function push() {
    if (!session) return;
    const uid = session.user.id;
    try {
      if (dirty.prefs || dirty.day || dirty.favs) {   // שורת profiles חייבת להתקיים לפני day_logs/favorites (FK)
        const rec = { id: uid };
        const state = parse(lsGet(STATE_KEY));
        if (dirty.prefs && state) { rec.prefs = state; rec.prefs_updated_at = meta.prefs || nowIso(); }
        const { error } = await sb.from('profiles').upsert(rec);
        if (error) return;                     // כשל רשת — הדגלים נשארים, ניסיון חוזר בפוקוס
        dirty.prefs = false;
      }
      if (dirty.day) {
        const payload = parse(lsGet(DAY_KEY));
        if (payload && payload.date) {
          const { error } = await sb.from('day_logs').upsert({
            trainee_id: uid, date: payload.date,
            payload, client_updated_at: meta.day || nowIso(),
          });
          if (error) return;
          await pushSummary(uid, payload);
        }
        dirty.day = false;
      }
      if (dirty.favs) {
        if (pendingFavUpserts.size) {
          const local = parse(lsGet(FAV_KEY)) || [];
          const rows = local.filter(f => pendingFavUpserts.has(f.fav_id)).map(f => ({
            trainee_id: uid, fav_id: f.fav_id, date: f.date,
            saved_at: f.saved_at, payload: f.payload,
          }));
          if (rows.length) {
            const { error } = await sb.from('favorites').upsert(rows);
            if (error) return;
          }
          pendingFavUpserts.clear();           // גם fav שנדחק מה-cap המקומי לא יעלה שוב
        }
        if (pendingFavDeletes.size) {
          const { error } = await sb.from('favorites')
            .delete().eq('trainee_id', uid).in('fav_id', [...pendingFavDeletes]);
          if (error) return;
          pendingFavDeletes.clear();
        }
        dirty.favs = false;
      }
      if (dirty.weight) {
        if (pendingWeightUpserts.size) {
          const local = readWeights();
          const rows = local.filter(w => pendingWeightUpserts.has(w.date)).map(w => ({
            trainee_id: uid, date: w.date, weight_kg: w.kg, client_updated_at: w.saved_at,
          }));
          if (rows.length) {
            const { error } = await sb.from('weight_logs').upsert(rows);
            if (error) return;
          }
          pendingWeightUpserts.clear();
        }
        if (pendingWeightDeletes.size) {
          const { error } = await sb.from('weight_logs')
            .delete().eq('trainee_id', uid).in('date', [...pendingWeightDeletes]);
          if (error) return;
          pendingWeightDeletes.clear();
        }
        dirty.weight = false;
      }
    } catch (e) { /* offline — הדגלים נשארים */ }
  }

  // עמוד נסגר/מוסתר — מנסים לדחוף מיד; כשל = ניסיון חוזר בפוקוס הבא
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(pushTimer); push(); }
  });
  window.addEventListener('focus', () => { if (dirty.prefs || dirty.day || dirty.favs) push(); });

  // ══════════ Pull: פעם אחת בעלייה — LWW פר-מפתח, המקומי גובר אם חדש יותר ══════════
  async function pull() {
    if (!session) return;
    const uid = session.user.id;
    try {
      const { data: prof } = await sb.from('profiles')
        .select('prefs,prefs_updated_at').eq('id', uid).maybeSingle();
      if (prof && prof.prefs && prof.prefs_updated_at &&
          (!meta.prefs || newer(prof.prefs_updated_at, meta.prefs))) {
        lsSet(STATE_KEY, JSON.stringify(prof.prefs));
        meta.prefs = prof.prefs_updated_at; saveMeta();
        try { loadState(); applyGender(); updateMacroDisplay(); } catch (e) {}
      }
      const { data: row } = await sb.from('day_logs')
        .select('payload,client_updated_at')
        .eq('trainee_id', uid).eq('date', todayStr()).maybeSingle();
      if (row && row.payload &&
          (!meta.day || newer(row.client_updated_at, meta.day))) {
        lsSet(DAY_KEY, JSON.stringify(row.payload));
        meta.day = row.client_updated_at; saveMeta();
        try { DAY = loadDay(); if (DAY) renderDay(); } catch (e) {}   // אותו מסלול כמו בעליית עמוד
      }
      // מועדפים: איחוד לפי fav_id — saved_at מאוחר גובר; לא מחיים מחיקה שממתינה לעלייה
      const { data: cloudFavs } = await sb.from('favorites')
        .select('fav_id,date,saved_at,payload')
        .eq('trainee_id', uid).order('saved_at', { ascending: false }).limit(30);
      if (Array.isArray(cloudFavs)) {
        const byId = {};
        (parse(lsGet(FAV_KEY)) || []).forEach(f => { byId[f.fav_id] = f; });
        cloudFavs.forEach(f => {
          if (pendingFavDeletes.has(f.fav_id)) return;
          if (!byId[f.fav_id] || newer(f.saved_at, byId[f.fav_id].saved_at)) byId[f.fav_id] = f;
        });
        const merged = Object.values(byId)
          .sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1)).slice(0, 30);
        lsSet(FAV_KEY, JSON.stringify(merged));
        try { updateFavHeart(); } catch (e) {}
      }
      // שקילות: מיזוג לפי תאריך — client_updated_at מאוחר גובר; לא מחיים מחיקה שממתינה לעלייה
      const { data: cloudW } = await sb.from('weight_logs')
        .select('date,weight_kg,client_updated_at')
        .eq('trainee_id', uid).order('date', { ascending: true });
      if (Array.isArray(cloudW)) {
        const byDate = {};
        readWeights().forEach(w => { byDate[w.date] = w; });
        cloudW.forEach(r => {
          if (pendingWeightDeletes.has(r.date)) return;
          const local = byDate[r.date];
          if (!local || newer(r.client_updated_at, local.saved_at))
            byDate[r.date] = { date: r.date, kg: Number(r.weight_kg), saved_at: r.client_updated_at };
        });
        writeWeights(Object.values(byDate));
        try { injectWeightSlot(); } catch (e) {}
      }
    } catch (e) { /* offline — בלי סנכרון הפעם */ }
  }

  // ══════════ עטיפות (הדפוס מהארכיטקטורה — binding על window) ══════════
  const _saveState = window.saveState;
  window.saveState = function () { _saveState.apply(this, arguments); markDirty('prefs'); };

  const _saveDay = window.saveDay;
  window.saveDay = function () { _saveDay.apply(this, arguments); markDirty('day'); };

  const _renderMenu = window.renderMenu;
  window.renderMenu = function () {
    _renderMenu.apply(this, arguments);
    track('menu_built');
  };

  // renderDay רץ גם בבנייה (דרך renderMenu) וגם בשחזור-מ-localStorage בעליית עמוד —
  // עטיפה אחת מזריקה את סלוט המשקל אחרי הסיכום בכל מסלול רינדור.
  const _renderDay = window.renderDay;
  if (typeof _renderDay === 'function') {
    window.renderDay = function () {
      _renderDay.apply(this, arguments);
      try { injectWeightSlot(); } catch (e) {}
    };
  }

  const _toggleEaten = window.toggleEaten;
  window.toggleEaten = function () {
    _toggleEaten.apply(this, arguments);
    try {
      if (dayComplete() && lsGet('shapeat-evt-day') !== todayStr()) {
        lsSet('shapeat-evt-day', todayStr());
        track('day_completed');
        maybeShowBanner();                     // רגע קבלת-הערך — הצעה רכה להתחבר
      }
    } catch (e) {}
  };

  const _saveFavorite = window.saveFavorite;
  window.saveFavorite = function () {
    // מועדפים = פיצ'ר חשבון. אנונימי אינו שומר "לשומקום" (אין לו מסך לראות אותו);
    // במקום זה נדנוד התחברות מפורש, וכוונת השמירה תמומש מיד עם ההתחברות.
    if (!session) {
      lsSet(FAV_INTENT_KEY, String(Date.now()));
      openLogin('כדי לשמור תפריטים ולראות אותם שוב בהיסטוריה צריך חשבון. ההתחברות תשמור מיד את התפריט הזה.');
      return null;
    }
    const res = _saveFavorite.apply(this, arguments);
    if (res && res.fav) {
      if (res.created) track('menu_saved');    // רק יצירה, לא עדכון snapshot
      pendingFavUpserts.add(res.fav.fav_id);
      markDirty('favs');
      // חוט מפורש מהלב אל החלון שרואים בו את התפריטים: פעולה שפותחת ישר את לשונית "שמורים"
      showToastSafe(res.created ? 'נשמר במועדפים ✓' : 'עודכן במועדפים ✓', 5000,
        { label: 'צפייה', onClick: () => openAccountModal('favs') });
    }
    return res;
  };

  const _removeFavorite = window.removeFavorite;
  window.removeFavorite = function (favId) {
    const res = _removeFavorite.apply(this, arguments);
    if (session) {
      pendingFavUpserts.delete(favId);
      pendingFavDeletes.add(favId);
      markDirty('favs');
    }
    return res;
  };

  // ══════════ באנר רך — רק אחרי קבלת ערך, דחייה = שקט לשבוע ══════════
  let bannerEl = null;
  function maybeShowBanner() {
    if (session || bannerEl) return;
    const dismissed = +(lsGet('shapeat-auth-dismissed') || 0);
    if (Date.now() - dismissed < 7 * 864e5) return;
    const first = lsGet('shapeat-first-seen');
    if (!first) { lsSet('shapeat-first-seen', todayStr()); return; }   // יום ראשון — עוד לא מציעים
    let earned = first !== todayStr();                                  // יום שני של שימוש
    try { earned = earned || dayComplete(); } catch (e) {}              // או השלמת יום
    if (!earned) return;

    bannerEl = document.createElement('div');
    bannerEl.className = 'sync-banner';
    const txt = document.createElement('span');
    txt.textContent = 'רוצה לשמור היסטוריה ולסנכרן בין מכשירים?';
    const login = document.createElement('button');
    login.className = 'sync-banner-btn';
    login.textContent = 'התחברות';
    login.onclick = () => { hideBanner(); openLogin(); };
    const later = document.createElement('button');
    later.className = 'sync-banner-later';
    later.textContent = 'לא עכשיו';
    later.onclick = () => { lsSet('shapeat-auth-dismissed', String(Date.now())); hideBanner(); };
    bannerEl.append(txt, login, later);
    document.body.appendChild(bannerEl);
  }
  function hideBanner() { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }

  // ══════════ מודאל התחברות: Google + magic link ══════════
  let authEl = null;
  function openLogin(subtitle) {
    if (authEl) return;
    pushBack(closeLogin);
    authEl = document.createElement('div');
    authEl.className = 'auth-overlay';
    authEl.addEventListener('click', e => { if (e.target === authEl) closeLogin(); });

    const box = document.createElement('div');
    box.className = 'auth-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'התחברות');

    const h = document.createElement('h3');
    h.textContent = 'שמירת היסטוריה וסנכרון';
    const p = document.createElement('p');
    p.className = 'auth-sub';
    p.textContent = subtitle || 'ההעדפות והימים שלך יישמרו לחשבון ויהיו זמינים מכל מכשיר.';

    // הסכמה אקטיבית (כמו הדיסקליימר): הכפתורים נעולים עד סימון
    const consent = document.createElement('label');
    consent.className = 'auth-consent';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const ctxt = document.createElement('span');
    ctxt.appendChild(document.createTextNode('אני מאשר/ת את '));
    const pl = document.createElement('a');
    pl.href = 'privacy.html';
    pl.target = '_blank';
    pl.rel = 'noopener';
    pl.textContent = 'מדיניות הפרטיות';
    ctxt.appendChild(pl);
    ctxt.appendChild(document.createTextNode(' ואת שמירת ההעדפות והתפריטים שלי בענן, לחשבוני בלבד.'));
    consent.append(cb, ctxt);
    cb.addEventListener('change', () => { gBtn.disabled = mBtn.disabled = !cb.checked; });

    const gBtn = document.createElement('button');
    gBtn.className = 'auth-google';
    gBtn.type = 'button';
    // הלוגו הרשמי של Google (4 צבעים) + טקסט — נכס סטטי מהימן, ללא קלט משתמש
    gBtn.innerHTML =
      '<svg class="g-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
      '<path fill="#4285F4" d="M17.64 9.2045c0-.6382-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"/>' +
      '<path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1809l-2.9087-2.2581c-.8064.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5832-5.0364-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"/>' +
      '<path fill="#FBBC05" d="M3.9636 10.71c-.18-.54-.2827-1.1168-.2827-1.71s.1027-1.17.2827-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9636 10.71z"/>' +
      '<path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9636 7.29C4.6718 5.1668 6.6559 3.5795 9 3.5795z"/>' +
      '</svg>' +
      '<span>המשך עם Google</span>';
    gBtn.disabled = true;
    gBtn.onclick = () => {
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname },
      }).catch(() => setStatus('החיבור נכשל, נסה שוב'));
    };

    const div = document.createElement('div');
    div.className = 'auth-divider';
    div.textContent = 'או';

    const email = document.createElement('input');
    email.type = 'email';
    email.className = 'auth-email';
    email.placeholder = 'כתובת אימייל';
    email.setAttribute('aria-label', 'כתובת אימייל');
    const mBtn = document.createElement('button');
    mBtn.className = 'auth-magic';
    mBtn.textContent = 'שלחו לי קוד';
    mBtn.disabled = true;

    // שלב 2: הזנת הקוד — נשאר באותו מכשיר/דפדפן (בלי קישור שנפתח במקום אחר)
    let sentEmail = '';
    const codeWrap = document.createElement('div');
    codeWrap.style.display = 'none';
    // חלונות ספרה (auto-advance, Backspace חוזר, הדבקה מלאה, אימות אוטומטי במילוי).
    // OTP_LEN חייב להתאים לאורך שמוגדר ב-Supabase (Authentication → Email OTP length).
    const OTP_LEN = 6;
    const boxesRow = document.createElement('div');
    boxesRow.className = 'otp-boxes';
    boxesRow.setAttribute('dir', 'ltr');   // ספרות משמאל-לימין כמו מספר
    const boxes = [];
    const getCode = () => boxes.map(b => b.value).join('');
    const clearBoxes = () => boxes.forEach(b => (b.value = ''));
    let verifying = false;
    async function doVerify() {
      const code = getCode();
      if (code.length !== OTP_LEN) { setStatus('הקוד הוא ' + OTP_LEN + ' ספרות'); return; }
      if (verifying) return;
      verifying = true; vBtn.disabled = true; setStatus('מאמת...');
      try {
        // ⚠️ שני סוגי טוקן. משתמש **חדש** מקבל אישור הרשמה (`signup`), משתמש קיים
        //    מקבל התחברות רגילה (`email`). אימות בסוג אחד בלבד היה נכשל בדיוק על
        //    מי שנרשם בפעם הראשונה, כלומר על הרושם הראשון. (12/08/2026)
        let { error } = await sb.auth.verifyOtp({ email: sentEmail, token: code, type: 'email' });
        if (error) ({ error } = await sb.auth.verifyOtp({ email: sentEmail, token: code, type: 'signup' }));
        if (error) { setStatus('קוד שגוי או שפג תוקפו, נסו שוב'); clearBoxes(); boxes[0].focus(); }
        // הצלחה → onAuthStateChange('SIGNED_IN') סוגר את המודאל וממזג
      } catch (e) { setStatus('האימות נכשל, נסו שוב'); }
      verifying = false; vBtn.disabled = false;
    }
    for (let i = 0; i < OTP_LEN; i++) {
      const b = document.createElement('input');
      b.type = 'text'; b.inputMode = 'numeric'; b.maxLength = 1;
      b.className = 'otp-box'; b.setAttribute('aria-label', 'ספרה ' + (i + 1));
      if (i === 0) b.autocomplete = 'one-time-code';
      b.addEventListener('input', () => {
        b.value = b.value.replace(/\D/g, '').slice(-1);
        if (b.value && i < OTP_LEN - 1) boxes[i + 1].focus();
        if (getCode().length === OTP_LEN) doVerify();
      });
      b.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !b.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].focus(); }
        else if (e.key === 'Enter') doVerify();
      });
      b.addEventListener('paste', e => {
        e.preventDefault();
        const digits = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, OTP_LEN);
        for (let j = 0; j + i < OTP_LEN && j < digits.length; j++) boxes[i + j].value = digits[j];
        boxes[Math.min(i + digits.length, OTP_LEN - 1)].focus();
        if (getCode().length === OTP_LEN) doVerify();
      });
      boxes.push(b); boxesRow.appendChild(b);
    }
    const vBtn = document.createElement('button');
    vBtn.className = 'auth-magic';
    vBtn.textContent = 'התחברות';
    vBtn.onclick = doVerify;
    const backBtn = document.createElement('button');
    backBtn.className = 'auth-cancel';
    backBtn.type = 'button';
    backBtn.textContent = 'שליחה לכתובת אחרת';
    codeWrap.append(boxesRow, vBtn, backBtn);

    function showCodeStep(addr) {
      sentEmail = addr;
      setStatus('שלחנו קוד בן ' + OTP_LEN + ' ספרות ל-' + addr + '. הזינו אותו כאן (תקף לשעה).');
      email.style.display = 'none'; mBtn.style.display = 'none';
      codeWrap.style.display = '';
      clearBoxes(); boxes[0].focus();
    }
    function showEmailStep() {
      codeWrap.style.display = 'none';
      email.style.display = ''; mBtn.style.display = '';
      mBtn.disabled = !cb.checked; setStatus(''); email.focus();
    }

    mBtn.onclick = async () => {
      const v = (email.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setStatus('כתובת אימייל לא תקינה'); return; }
      mBtn.disabled = true; setStatus('שולח...');
      try {
        const { error } = await sb.auth.signInWithOtp({ email: v });
        if (!error) { showCodeStep(v); return; }
        setStatus(error.status === 429 ? 'נשלחו יותר מדי מיילים. נסו שוב בעוד כשעה' : 'השליחה נכשלה, נסו שוב');
      } catch (e) { setStatus('השליחה נכשלה, נסו שוב'); }
      mBtn.disabled = !cb.checked;
    };
    backBtn.onclick = showEmailStep;
    email.addEventListener('keydown', e => { if (e.key === 'Enter' && !mBtn.disabled) mBtn.click(); });

    const status = document.createElement('p');
    status.className = 'auth-status';
    status.setAttribute('aria-live', 'polite');
    function setStatus(t) { status.textContent = t; }

    const x = document.createElement('button');
    x.className = 'auth-close';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'סגירה');
    x.onclick = closeLogin;

    box.append(x, h, p, consent, gBtn, div, email, mBtn, codeWrap, status);
    authEl.appendChild(box);
    document.body.appendChild(authEl);

    // focus-trap בסיסי (כמו מודאל הדיסקליימר): Esc סוגר, Tab נשאר בתוך המודאל
    cb.focus();
    authEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeLogin();
      if (e.key === 'Tab') {
        const items = [...box.querySelectorAll('button,input')].filter(el => !el.disabled && el.offsetParent !== null);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function closeLogin() { if (!authEl) return; authEl.remove(); authEl = null; popBack(); }

  // ============================================================
  // חיבור למאמנת (?join=<invite_code>)
  //
  // הלינק לעולם לא מחבר לבד — הוא רק פותח את מסך ההסכמה. בלי אישור אקטיבי
  // לא נוצרת שורה. אם הלינק הודבק בקבוצה, כל מי שיאשר ייכנס אמנם, אבל
  // המאמנת מסירה בלחיצה ויכולה לרענן את הקוד (rotate_invite).
  // ============================================================
  const LINKED_KEY = 'shapeat-was-linked';  // "היה כאן קישור" — מבדיל בין מי שהתנתקה
                                            // (⇒ להוריד מיתוג) לבין מי שרק הגיעה מלינק ממותג
  const JOIN_KEY = 'shapeat-join-intent';   // שורד את ה-redirect של OAuth/magic-link
  const JOIN_MS  = 30 * 60 * 1000;
  const CONSENT_VERSION = 3;                // כל שינוי בנוסח למטה מחייב העלאת המספר הזה
                                            // v2 (08/08/2026): פירוט מפת 14 הימים במקום "אחוז הארוחות"
                                            // v3 (12/08/2026): תיבת המשקל נוסחה כמשפט עצמאי ("אני מאשר/ת ש...")
                                            //   במקום המשך של התיבה שמעליה
  let joinEl = null;

  function closeJoin() { if (!joinEl) return; joinEl.remove(); joinEl = null; popBack(); }

  async function openJoin(invite) {
    if (joinEl) return;
    const { data, error } = await sb.rpc('coach_by_invite', { invite });
    const coach = !error && data && data[0];
    if (!coach) { showToastSafe('קישור ההזמנה אינו תקף'); return; }
    track('coach_link_visited', { slug: coach.slug });

    joinEl = document.createElement('div');
    joinEl.className = 'auth-overlay';
    joinEl.addEventListener('click', e => { if (e.target === joinEl) closeJoin(); });

    const box = document.createElement('div');
    box.className = 'auth-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'חיבור למאמן');

    const h = document.createElement('h3');
    h.textContent = 'להתחבר אל ' + coach.display_name + '?';   // textContent — שם מהמאמנת אינו HTML
    const sub = document.createElement('p');
    sub.className = 'auth-sub';
    sub.textContent = coach.tagline || '';

    // הרשימה המפורשת. "לא רואה" מנוסח קונקרטית כי זה מה שמייצר אמון.
    const seeT = document.createElement('p');
    seeT.className = 'join-h';
    seeT.textContent = 'מה שהמאמן/ת יראו:';
    const see = document.createElement('ul');
    see.className = 'join-list';
    // מפורט יותר מ"אחוז הארוחות": הדשבורד מציג מפה של 14 יום, ולכן ההסכמה
    // חייבת לומר בדיוק את זה. הבטחה כללית מדי מול תצוגה גרעינית היא הטעיה.
    ['באילו ימים סימנת, ב-14 הימים האחרונים', 'כמה ארוחות סימנת בכל יום',
     'רצף הימים שלך', 'המטרה שנבחרה כאן']   // לשון ניטרלית: המתאמן/ת אינו בהכרח אישה
      .forEach(t => { const li = document.createElement('li'); li.textContent = t; see.appendChild(li); });

    const noT = document.createElement('p');
    noT.className = 'join-h';
    noT.textContent = 'מה שהם לא יראו:';
    const no = document.createElement('ul');
    no.className = 'join-list no';
    ['את התפריט ואת המאכלים', 'קלוריות ומאקרו', 'את המשקל שלך בק"ג']
      .forEach(t => { const li = document.createElement('li'); li.textContent = t; no.appendChild(li); });

    const nameL = document.createElement('label');
    nameL.className = 'join-field';
    nameL.textContent = 'השם שיוצג למאמן/ת';
    const nameI = document.createElement('input');
    nameI.type = 'text';
    nameI.className = 'auth-email';
    nameI.maxLength = 40;
    nameI.placeholder = 'איך שקוראים לך';
    nameL.appendChild(nameI);

    const goalL = document.createElement('label');
    goalL.className = 'join-field';
    goalL.textContent = 'המטרה שלי';
    const goalS = document.createElement('select');
    goalS.className = 'auth-email';
    [['cut', 'חיטוב'], ['maintain', 'שמירה'], ['bulk', 'עלייה במסה']]
      .forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; goalS.appendChild(o); });
    try { if (typeof S !== 'undefined' && S.goal) goalS.value = S.goal; } catch (e) {}
    goalL.appendChild(goalS);

    // הסכמה 1 — חובה
    const c1 = document.createElement('label');
    c1.className = 'auth-consent';
    const cb1 = document.createElement('input'); cb1.type = 'checkbox';
    const t1 = document.createElement('span');
    t1.textContent = 'אני מאשר/ת ש' + coach.display_name + ' יראו את ההתמדה שלי.';
    c1.append(cb1, t1);

    // הסכמה 2 — רשות, ונפרדת במכוון. משקל הוא הנתון הרגיש ביותר במוצר.
    const c2 = document.createElement('label');
    c2.className = 'auth-consent';
    const cb2 = document.createElement('input'); cb2.type = 'checkbox';
    const t2 = document.createElement('span');
    // ⚠️ נוסח עצמאי במכוון (12/08/2026). קודם הוא התחיל ב"גם מגמת המשקל שלי...",
    //    כלומר משפט שנשען על התיבה שמעליו. תיבת הסכמה נפרדת חייבת לעמוד בפני
    //    עצמה, אחרת ההפרדה קיימת בממשק ולא בתוכן, ומי שקורא רק אותה לא יודע
    //    למה בדיוק הוא מסכים.
    //    בלי "גם" ובלי "אפשר להצטרף בלי לסמן": התיבה אומרת מה מאשרים, נקודה.
    //    שהיא רשות נלמד מכך שהכפתור פעיל בלעדיה, ולא מהערה על עצמה.
    t2.textContent = 'אני מאשר/ת ש' + coach.display_name +
      ' יראו את מגמת המשקל שלי: את הכיוון ואת ההפרש בלבד, ולא את המשקל בק"ג.';
    c2.append(cb2, t2);

    const go = document.createElement('button');
    go.className = 'auth-google';
    go.type = 'button';
    go.textContent = 'מתחבר/ת';
    go.disabled = true;
    cb1.addEventListener('change', () => { go.disabled = !cb1.checked; });

    const status = document.createElement('div');
    status.className = 'auth-status';

    go.onclick = async () => {
      const payload = {
        invite,
        name: (nameI.value || '').trim().slice(0, 40) || 'מתאמן/ת',
        goal: goalS.value,
        weight: cb2.checked,
        ts: Date.now(),
      };
      lsSet(JOIN_KEY, JSON.stringify(payload));
      if (!session) { closeJoin(); openLogin('כדי להתחבר למאמן/ת צריך חשבון — כך ההתמדה נשמרת ומסונכרנת.'); return; }
      go.disabled = true; status.textContent = 'מחבר…';
      const ok = await doJoin(payload);
      if (ok) closeJoin(); else { status.textContent = 'החיבור נכשל, נסו שוב'; go.disabled = false; }
    };

    const skip = document.createElement('button');
    skip.className = 'auth-skip';
    skip.type = 'button';
    skip.textContent = 'לא עכשיו';
    skip.onclick = closeJoin;

    box.append(h, sub, seeT, see, noT, no, nameL, goalL, c1, c2, go, status, skip);
    joinEl.appendChild(box);
    document.body.appendChild(joinEl);
    pushBack(closeJoin);   // אחרי כל היציאות המוקדמות, כדי שלא תישאר רשומה יתומה
    setTimeout(() => nameI.focus(), 30);
  }

  // יצירת הקישור בפועל. מנתק קישור קודם אם קיים (המסמך: החלפת מאמן = revoke + insert).
  async function doJoin(p) {
    if (!session) return false;
    try {
      const { data, error: e1 } = await sb.rpc('coach_by_invite', { invite: p.invite });
      const coach = !e1 && data && data[0];
      if (!coach) return false;

      // ⚠️ coach_links.trainee_id מפנה ל-profiles במפתח זר, ושורת profiles נוצרת
      // רק בדחיפה הראשונה. firstMerge דוחף אותה בכל התחברות, אבל זה מרוץ ולא
      // ערובה: מתאמנת חדשה שמאשרת לפני שהדחיפה חזרה מהרשת הייתה מקבלת הפרת FK
      // ו"החיבור נכשל" בלי שום הסבר — ודווקא ברגע היקר ביותר, ההצטרפות הראשונה.
      // upsert אידמפוטנטי תחת ה-RLS הקיים (שורה שלך בלבד) מסיר את התלות בתזמון.
      const { error: e0 } = await sb.from('profiles').upsert({ id: session.user.id });
      if (e0) return false;

      await sb.from('coach_links').update({ status: 'revoked' })
        .eq('trainee_id', session.user.id).eq('status', 'active');

      const { error } = await sb.from('coach_links').insert({
        trainee_id: session.user.id,
        coach_id: coach.id,
        trainee_display_name: p.name,
        trainee_goal: p.goal,
        share_weight: !!p.weight,
        consent_text_version: CONSENT_VERSION,
      });
      if (error) return false;

      track('coach_connected', { slug: coach.slug });
      // צובעים מיד, באותו רגע. השם, הסלוגן והצבע כבר בידינו מהמסך עצמו, ובלי זה
      // המסך נשאר במותג הבית עד שהמתאמנת תרענן מיוזמתה. (דווח 09/08/2026)
      try {
        window.shapeatApplyCoach({ slug: coach.slug, name: coach.display_name,
          tagline: coach.tagline, color: coach.brand_color, color2: null, logo: coach.logo_path || null });
      } catch (e) { try { lsSet('shapeat-coach', coach.slug); } catch (e2) {} }
      try { lsSet(LINKED_KEY, '1'); } catch (e) {}
      showToastSafe('מחובר/ת ל' + coach.display_name + ' ✓', 4000);
      // הסיכום של היום הנוכחי יעלה בסימון הבא; ההסכמה לא פותחת עבר ממילא.
      markDirty('day');
      return true;
    } catch (e) { return false; }
  }

  // הדאטהבייס יודע מי המאמן/ת; הדפדפן לא בהכרח. מי שהתחברה מלינק ישן, ניקתה
  // אחסון, או נכנסת ממכשיר אחר — תקבל את המיתוג מעצמה, בלי לשלוח אותה לשום כתובת.
  // ⚠️ *רק מוסיפים*. אין קישור ⇒ לא נוגעים במיתוג קיים, אחרת מי שהגיעה מלינק
  //    ממותג וטרם אישרה הייתה מאבדת אותו באמצע.
  async function syncCoachBrand() {
    if (!session) return;
    try {
      // ⚠️ לא לצרף ל-coaches: ה-RLS שם מתיר לקרוא *רק את שורתך שלך*, ולכן
      // מתאמנת רגילה הייתה מקבלת null תמיד. coaches_public הוא ה-view שפתוח
      // לכולם (מאושרים בלבד, שדות מיתוג בלבד). שתי שאילתות במקום צירוף אחד.
      const { data: link } = await sb.from('coach_links')
        .select('coach_id').eq('status', 'active').maybeSingle();
      let c = null;
      if (link && link.coach_id) {
        const { data: pub } = await sb.from('coaches_public')
          .select('slug,display_name,tagline,brand_color,logo_path')
          .eq('id', link.coach_id).maybeSingle();
        c = pub || null;
      }
      // מאמן/ת אינם מתאמנים של עצמם (006 חוסם), ולכן אין להם שורת קישור. הם
      // עדיין אמורים לראות את המותג שלהם באפליקציה — גם כדי להדגים אותו ללקוחה.
      if (!c) {
        const own = await sb.from('coaches')
          .select('slug,display_name,tagline,brand_color,logo_path').maybeSingle();
        c = own && own.data;
      }
      if (c) {
        lsSet(LINKED_KEY, '1');                        // מסמנים שהיה קישור
        if (lsGet('shapeat-coach') === c.slug) return; // כבר ממותג נכון
        const brand = { slug: c.slug, name: c.display_name, tagline: c.tagline,
          color: c.brand_color, color2: null, logo: c.logo_path || null };
        // נפילה לאחור אם coach-theme לא נטען: כותבים את המיתוג ומרעננים. פחות חלק
        // מצביעה חיה, אבל המסך *כן* יוצא ממותג. בלי זה כשל כאן נבלע ב-catch ונשאר
        // בלתי נראה לחלוטין, וכך בדיוק הוחמץ הבאג של 09/08.
        if (typeof window.shapeatApplyCoach === 'function') {
          window.shapeatApplyCoach(brand);
        } else {
          try {
            lsSet('shapeat-coach', c.slug);
            localStorage.setItem('shapeat-coach-brand', JSON.stringify(brand));
            location.reload();
          } catch (e) {}
        }
        return;
      }
      // אין קישור. מסירים מיתוג **רק** אם היה כאן קישור בעבר (התנתקה או הוסרה).
      // מי שהגיעה מלינק ממותג וטרם אישרה נשארת ממותגת — המאמנת הביאה אותה,
      // ולא נוריד לה את הווייט-לייבל באמצע השוטטות. (הוכרע 09/08/2026)
      if (lsGet(LINKED_KEY)) {
        lsSet(LINKED_KEY, '');
        try { lsSet('shapeat-coach', ''); localStorage.removeItem('shapeat-coach-brand'); } catch (e) {}
        location.reload();                             // חוזרים למותג הבית
      }
    } catch (e) {}
  }

  async function revokeCoach() {
    if (!session) return;
    try {
      await sb.from('coach_links').update({ status: 'revoked' })
        .eq('trainee_id', session.user.id).eq('status', 'active');
      track('consent_revoked');
      // מנקים גם את הסימון וגם את המטמון, אחרת syncCoachBrand יזהה "היה קישור
      // ואין" ויבצע רענון מיותר בטעינה הבאה
      try { lsSet('shapeat-coach', ''); lsSet(LINKED_KEY, '');
            localStorage.removeItem('shapeat-coach-brand'); } catch (e) {}
      showToastSafe('נותקת מהמאמן/ת');
    } catch (e) {}
  }

  // ══════════ מיזוג ראשוני בהתחברות: pull (ענן חדש גובר) ← push (מקומי קיים עולה) ══════════
  async function firstMerge() {
    await pull();
    if (!meta.prefs) { meta.prefs = nowIso(); }
    if (!meta.day)   { meta.day   = nowIso(); }
    saveMeta();
    dirty.prefs = true;
    dirty.day   = !!parse(lsGet(DAY_KEY));
    // כל המועדפים המקומיים (כולל מה שהתמזג עכשיו) עולים — upsert אידמפוטנטי
    const favs = parse(lsGet(FAV_KEY)) || [];
    if (favs.length) {
      favs.forEach(f => pendingFavUpserts.add(f.fav_id));
      dirty.favs = true;
    }
    push();
  }

  // ══════════ מודאל "החשבון שלי" — היסטוריה (ימים מהענן) + מועדפים + ניהול חשבון ══════════
  // pull() שרץ ברקע בזמן שהמודאל פתוח לא מפריע — המודאל יושב על body, לא בתוך #menu-output.
  let accountEl = null;

  // סטטיסטיקות שורה מ-payload של serializeDay (eaten צמוד לאינדקסים של meals המלא)
  // ── סיכום התמדה למאמנת (day_summaries) ──
  // טבלה נפרדת פיזית מ-day_logs: מה שלא נמצא בה לא יכול לדלוף. אין כאן קלוריות, מאכלים או משקל.
  // ⚠️ פינוק מתוכנן *אינו* נספר כארוחה: הוא בחירה ולא מטלה, וספירתו הייתה מאפשרת
  //    להעלות אחוז התמדה פשוט ע"י הוספת פינוקים. (dayStats הקיים כן סופר אותו — לכן לא ממחזרים אותו.)
  function summaryStats(payload) {
    let planned = 0, eaten = 0;
    (payload.meals || []).forEach((m, i) => {
      if (m.removed || m.type === 'treat') return;
      planned++;
      if (payload.eaten && payload.eaten[i]) eaten++;
    });
    return { planned, eaten: Math.min(eaten, planned) };
  }

  async function pushSummary(uid, payload) {
    const st = summaryStats(payload);
    if (st.planned < 1 || st.planned > 10) return;   // מכובד ה-check ב-DB (1..10)
    try {
      // כשל כאן לא חוסם ולא מחזיר: היום עצמו כבר נשמר, והסימון הבא ינסה שוב.
      await sb.from('day_summaries').upsert({
        trainee_id: uid, date: payload.date,
        meals_planned: st.planned, meals_eaten: st.eaten,
        completed: st.eaten >= st.planned,
      });
    } catch (e) {}
  }

  function dayStats(payload) {
    let planned = 0, eaten = 0, cal = 0;
    (payload.meals || []).forEach((m, i) => {
      if (m.removed) return;
      planned++;
      cal += m.totCal || 0;
      if (payload.eaten && payload.eaten[i]) eaten++;
    });
    return { planned, eaten, cal: Math.round(cal) };
  }

  function dateLabel(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00')
        .toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
    } catch (e) { return dateStr; }
  }

  // שעת השמירה — המבדיל בין כמה מועדפים באותו יום (מטרה+קלוריות זהות ב"תפריט נוסף")
  function timeLabel(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return '';
      return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function openAccountModal(initialTab) {
    if (accountEl || !session) return;
    pushBack(closeAccountModal);
    accountEl = document.createElement('div');
    accountEl.className = 'auth-overlay account-overlay';   // account-overlay → מסך-מלא במובייל (scoped, לא נוגע במודאל ההתחברות)
    accountEl.addEventListener('click', e => { if (e.target === accountEl) closeAccountModal(); });

    const box = document.createElement('div');
    box.className = 'auth-box account-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'החשבון שלי');

    const x = document.createElement('button');
    x.className = 'auth-close';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'סגירה');
    x.onclick = closeAccountModal;

    // גלגל שיניים — ניהול חשבון (מייל/התנתקות/מחיקה) יושב רמה אחת עמוק, מחוץ לתוכן היומיומי
    const gear = document.createElement('button');
    gear.className = 'account-gear';
    gear.setAttribute('aria-label', 'ניהול חשבון');
    gear.title = 'ניהול חשבון';
    gear.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    const h = document.createElement('h3');
    h.textContent = 'החשבון שלי';

    // שורת סטטוס מעל הטאבים. שתי אפשרויות, שתיהן מוצגות רק למי שהן רלוונטיות לו:
    //  • מחוברת למאמן/ת → *מי* רואה את הנתונים שלה. יחסי שיתוף פעילים חייבים להיות
    //    גלויים במבט אחד, לא קבורים מאחורי גלגל שיניים. זה עיקרון פרטיות, לא נוחות.
    //  • בעלת פרופיל מאמן/ת → קיצור לדשבורד, כדי שלא תהיה תלויה בלינק ששמרה.
    // למשתמשת רגילה בלי חיבור השורה לא קיימת בכלל.
    const statusRow = document.createElement('div');
    statusRow.className = 'account-status';
    statusRow.style.display = 'none';
    (async () => {
      try {
        const [{ data: lnk }, { data: cch }] = await Promise.all([
          sb.from('coach_links').select('coaches(display_name)').eq('status', 'active').maybeSingle(),
          sb.from('coaches').select('display_name').maybeSingle(),
        ]);
        if (lnk && lnk.coaches) {
          const s = document.createElement('span');
          s.textContent = 'מחובר/ת ל' + lnk.coaches.display_name;
          statusRow.appendChild(s);
        }
        if (cch) {
          const a2 = document.createElement('a');
          a2.href = '/coach';
          a2.className = 'account-dash-link';
          a2.textContent = 'דשבורד מאמנים ←';
          statusRow.appendChild(a2);
        }
        if (statusRow.childNodes.length) statusRow.style.display = '';
      } catch (e) {}
    })();

    // טאבים
    const tabs = document.createElement('div');
    tabs.className = 'account-tabs';
    const tabProg = document.createElement('button');
    tabProg.className = 'account-tab active';   // ברירת מחדל — הדבר הכי מוטיבציוני לראות
    tabProg.textContent = 'התקדמות 📈';
    const tabDays = document.createElement('button');
    tabDays.className = 'account-tab';
    tabDays.textContent = 'ימים';
    const tabFavs = document.createElement('button');
    tabFavs.className = 'account-tab';
    tabFavs.textContent = 'שמורים ♥';
    tabs.append(tabProg, tabDays, tabFavs);

    const list = document.createElement('div');
    list.className = 'account-list';

    // תצוגת יום קריאה-בלבד (מוחלפת עם הרשימה)
    const roWrap = document.createElement('div');
    roWrap.className = 'ro-day';
    roWrap.style.display = 'none';

    // תת-מסך "ניהול חשבון" (נפתח מגלגל השיניים) — הפעולות הטכניות/ההרסניות, רמה אחת עמוק
    const settingsWrap = document.createElement('div');
    settingsWrap.className = 'account-settings';
    settingsWrap.style.display = 'none';

    function showList() {
      roWrap.style.display = 'none';
      roWrap.innerHTML = '';
      settingsWrap.style.display = 'none';
      tabs.style.display = '';
      list.style.display = '';
      gear.style.display = '';
    }
    function showRoDay(payload, title) {
      try {
        const day = deserializeDay(payload);
        roWrap.innerHTML = '';
        const back = document.createElement('button');
        back.className = 'pill-btn ro-back';
        back.textContent = '→ חזרה לרשימה';
        back.onclick = showList;
        const content = document.createElement('div');
        content.innerHTML = dayHtml(day, { readOnly: true, title });   // dayHtml עובר esc על הכל
        roWrap.append(back, content);
        tabs.style.display = 'none';
        list.style.display = 'none';
        settingsWrap.style.display = 'none';
        gear.style.display = 'none';
        roWrap.style.display = '';
        roWrap.scrollTop = 0;
      } catch (e) {
        showToastSafe('לא ניתן להציג יום זה');
      }
    }
    function showSettings() {
      tabs.style.display = 'none';
      list.style.display = 'none';
      roWrap.style.display = 'none';
      gear.style.display = 'none';
      settingsWrap.style.display = '';
      settingsWrap.scrollTop = 0;
    }
    gear.onclick = showSettings;

    function emptyMsg(t) {
      const d = document.createElement('div');
      d.className = 'account-empty';
      d.textContent = t;
      return d;
    }

    function favRow(f) {
      const row = document.createElement('div');
      row.className = 'account-row';
      const del = document.createElement('button');
      del.className = 'row-del';
      del.textContent = '✕';
      del.title = 'הסר מהמועדפים';
      del.onclick = e => {
        e.stopPropagation();
        window.removeFavorite(f.fav_id);       // העטוף — מסנכרן גם לענן
        showToastSafe('הוסר מהמועדפים');
        renderFavs();
      };
      row.classList.add('fav-row');
      const d = document.createElement('span');
      d.className = 'row-date';
      // השעה ירדה (11/08/2026): היא הבדילה רק בין שתי שמירות באותו יום, ומטרה
      // וקלוריות מבדילות טוב יותר. שורה צרה בטלפון סובלת מכל פריט מיותר.
      d.textContent = dateLabel(f.date);
      const meta1 = document.createElement('span');
      meta1.className = 'row-meta';
      const gl = f.payload && f.payload.gLabel;
      meta1.textContent = Math.round(favCalories(f.payload)).toLocaleString() + ' קק"ל' + (gl ? ' · ' + gl : '');
      row.append(del, d, meta1);

      if (favFitsTarget(f.payload)) {
        const fit = document.createElement('span');
        fit.className = 'fav-fit';
        fit.textContent = 'מתאים ליעד היום';
        row.appendChild(fit);
      }

      // שחזור: מחזיר את התפריט להיות היום הפעיל, כדי שאפשר יהיה לסמן ולערוך בו.
      // stopPropagation כי לחיצה על השורה עצמה פותחת תצוגה לקריאה בלבד.
      const back = document.createElement('button');
      back.className = 'row-restore';
      back.textContent = '↩ החזר לתפריט';
      back.title = 'להפוך את התפריט הזה לתפריט של היום';
      back.onclick = e => {
        e.stopPropagation();
        let ok = false;
        try { ok = window.restoreFavorite(f.payload); } catch (err) {}
        if (ok) { closeAccountModal(); showToastSafe('התפריט הוחזר ליום ✓'); }
      };
      row.appendChild(back);

      row.onclick = () => showRoDay(f.payload, 'תפריט שמור · ' + dateLabel(f.date));
      return row;
    }

    function renderFavs() {
      list.innerHTML = '';
      let favs = [];
      try { favs = listFavorites(); } catch (e) {}
      if (!favs.length) { list.appendChild(emptyMsg('עוד אין תפריטים שמורים — לב ♡ במסך התפריט שומר אותו לכאן')); return; }
      // המתאימים ליעד קודם. זו ההגנה האמיתית מפני שחזור של תפריט לא מתאים:
      // הבחירה הנכונה היא הראשונה ומסומנת, ולכן אין צורך לחסום את השאר.
      let fit = [], rest = [];
      favs.forEach(f => { (favFitsTarget(f.payload) ? fit : rest).push(f); });
      fit.concat(rest).forEach(f => list.appendChild(favRow(f)));
    }

    async function renderDays() {
      list.innerHTML = '';
      list.appendChild(emptyMsg('טוען...'));
      try {
        const { data, error } = await sb.from('day_logs')
          .select('date,payload')
          .eq('trainee_id', session.user.id)
          .order('date', { ascending: false }).limit(30);
        if (error) throw error;
        list.innerHTML = '';
        if (!data || !data.length) { list.appendChild(emptyMsg('עוד אין ימים שמורים בענן — הם נאספים מעכשיו, יום אחרי יום')); return; }
        data.forEach(r => {
          const row = document.createElement('div');
          row.className = 'account-row';
          const d = document.createElement('span');
          d.className = 'row-date';
          d.textContent = (r.date === todayStr() ? 'היום · ' : '') + dateLabel(r.date);
          const s = dayStats(r.payload || {});
          const meta1 = document.createElement('span');
          meta1.className = 'row-meta';
          meta1.textContent = `נאכלו ${s.eaten}/${s.planned} · ${s.cal.toLocaleString()} קק"ל`;
          row.append(d, meta1);
          row.onclick = () => showRoDay(r.payload, 'התפריט של ' + dateLabel(r.date));
          list.appendChild(row);
        });
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(emptyMsg('לא ניתן לטעון כרגע — בדוק חיבור ונסה שוב'));
      }
    }

    const setActive = t => [tabProg, tabDays, tabFavs].forEach(b => b.classList.toggle('active', b === t));
    tabProg.onclick = () => { setActive(tabProg); renderProgress(list); };
    tabDays.onclick = () => { setActive(tabDays); renderDays(); };
    tabFavs.onclick = () => { setActive(tabFavs); renderFavs(); };

    // ── תת-מסך "ניהול חשבון" (מייל + התנתקות + מחיקה) ──
    const setBack = document.createElement('button');
    setBack.className = 'pill-btn ro-back';
    setBack.textContent = '→ חזרה';
    setBack.onclick = showList;
    const setTitle = document.createElement('h4');
    setTitle.className = 'account-settings-title';
    setTitle.textContent = 'ניהול חשבון';
    const email = document.createElement('p');
    email.className = 'account-email';
    email.textContent = session.user.email || '';
    const logout = document.createElement('button');
    logout.className = 'account-logout';
    logout.textContent = 'התנתקות';
    logout.onclick = async () => {
      try { await sb.auth.signOut(); } catch (e) {}
      closeAccountModal();
      showToastSafe('התנתקת ✓ הנתונים במכשיר נשארו');
    };
    const del = document.createElement('button');
    del.className = 'account-delete';
    del.textContent = 'מחיקת חשבון';
    del.onclick = async () => {
      if (!confirm('למחוק את החשבון לצמיתות?\nכל הימים והתפריטים השמורים בענן יימחקו ולא ניתן יהיה לשחזר אותם.\nהנתונים השמורים במכשיר הזה יישארו.')) return;
      try {
        await sb.rpc('delete_my_account');
        await sb.auth.signOut();
        try { localStorage.removeItem(META_KEY); localStorage.removeItem('shapeat-signup-sent'); } catch (e) {}
        location.reload();
      } catch (e) { showToastSafe('המחיקה נכשלה — נסה שוב'); }
    };
    // ניתוק מהמאמן/ת — מוצג רק כשקיים קישור פעיל. אפקט מיידי דרך RLS.
    const unlink = document.createElement('button');
    unlink.className = 'account-logout';
    unlink.style.display = 'none';
    settingsWrap.append(setBack, setTitle, email, unlink, logout, del);
    (async () => {
      try {
        const { data } = await sb.from('coach_links')
          .select('id, coaches(display_name)').eq('status', 'active').maybeSingle();
        if (!data) return;
        const nm = (data.coaches && data.coaches.display_name) || 'המאמן/ת';
        unlink.textContent = 'ניתוק מ' + nm;
        unlink.style.display = '';
        unlink.onclick = async () => {
          if (!confirm('לנתק מ' + nm + '?\nהם יפסיקו לראות את ההתמדה שלך מיד. התפריטים והנתונים שלך לא מושפעים.')) return;
          await revokeCoach();
          unlink.style.display = 'none';
        };
      } catch (e) {}
    })();

    box.append(x, gear, h, statusRow, tabs, list, roWrap, settingsWrap);
    accountEl.appendChild(box);
    document.body.appendChild(accountEl);

    if (initialTab === 'favs') { setActive(tabFavs); renderFavs(); tabFavs.focus(); }
    else if (initialTab === 'days') { setActive(tabDays); renderDays(); tabDays.focus(); }
    else { renderProgress(list); tabProg.focus(); }   // ברירת מחדל: התקדמות
    accountEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAccountModal();
      if (e.key === 'Tab') {
        const items = [...box.querySelectorAll('button')].filter(el => !el.disabled && el.offsetParent !== null);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function closeAccountModal() {
    if (!accountEl) return;
    accountEl.remove(); accountEl = null;
    popBack();   // חזרה באנדרואיד סוגרת את המסך במקום לצאת מהאפליקציה
    try { updateFavHeart(); } catch (e) {}   // הלב במסך התפריט משקף מחיקות שנעשו בתוך המודאל
  }
  function showToastSafe(m, ms, action) { try { showToast(m, ms, action); } catch (e) {} }

  // ══════════ אייקון חשבון קבוע בכותרת — נקודת הכניסה שפתרה את "פספסתי את הבאנר" ══════════
  let accountBtn = null;
  function injectAccountBtn() {
    const header = document.querySelector('header');
    if (!header || accountBtn) return;
    accountBtn = document.createElement('button');
    accountBtn.id = 'account-btn';
    accountBtn.className = 'account-btn';
    accountBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
    accountBtn.onclick = () => (session ? openAccountModal() : openLogin());
    updateAccountBtn();
    header.appendChild(accountBtn);
  }
  function updateAccountBtn() {
    if (!accountBtn) return;
    accountBtn.classList.toggle('connected', !!session);
    accountBtn.setAttribute('aria-label', session ? 'החשבון שלי — מחובר' : 'התחברות לחשבון');
    accountBtn.title = session ? 'החשבון שלי' : 'התחברות';
  }

  // ══════════ מעקב משקל v1 — גרף התקדמות (מפרט: ROADMAP "מעקב משקל v1", grilling 11/07/2026) ══════════
  // אחסון: local-first cache (WEIGHT_KEY) שהוא מקור התצוגה; הענן (weight_logs) מתמזג פנימה (pull) והחוצה (push).
  // גישה: פיצ'ר חשבון — אנונימי רואה רק פיתיון. הכל additive (כמו שכבת החשבון), נוגע מינימלית ב-ui/app.
  function readWeights() {
    const a = parse(lsGet(WEIGHT_KEY));
    return Array.isArray(a) ? a.slice().sort((x, y) => (x.date < y.date ? -1 : 1)) : [];
  }
  function writeWeights(arr) {
    const clean = arr.filter(w => w && w.date && isFinite(w.kg))
      .sort((x, y) => (x.date < y.date ? -1 : 1));
    lsSet(WEIGHT_KEY, JSON.stringify(clean));
  }
  const listWeights = () => readWeights();
  function clampKg(n) {
    const v = Math.round(Number(n) * 10) / 10;
    return (isFinite(v) && v >= 30 && v <= 300) ? v : null;   // clamp לקוח (DB רחב יותר 20–400)
  }
  function heightM() { try { return S && S.height ? S.height / 100 : null; } catch (e) { return null; } }
  function bmiOf(kg) { const h = heightM(); return h ? kg / (h * h) : null; }
  function buildWeight() { try { return (typeof DAY !== 'undefined' && DAY && DAY.date) || todayStr(); } catch (e) { return null; } }
  function seedKg() { try { return S && S.weight ? clampKg(S.weight) : null; } catch (e) { return null; } }
  function weeksDue() {
    const a = readWeights(); if (!a.length) return false;
    return (Date.now() - Date.parse(a[a.length - 1].date)) / 864e5 >= 7;
  }
  const todayWeighed = () => readWeights().some(w => w.date === todayStr());
  // תווית הכפתור הראשי: יש שקילה היום → עריכה; אחרת שקילה חדשה (בולט אם עברה שבוע)
  function addBtnLabel() {
    if (todayWeighed()) return '✏️ עריכת שקילת היום';
    return weeksDue() ? 'עדכנו משקל' : '+ שקילה';
  }

  // הערת תת-משקל: פעם אחת לאפיזודה; מדוכאת ל"מסה שלא יורדת"; נורית ל"מסה שיורדת" ולשמירה. (ROADMAP)
  function underweightReferral(dateStr, kg) {
    const bmi = bmiOf(kg); if (bmi == null) return;
    if (bmi >= 18.5) { lsSet(UW_KEY, ''); return; }            // מעל הסף → איפוס דגל אפיזודה
    const before = readWeights().filter(w => w.date < dateStr);
    const prev = before.length ? before[before.length - 1] : null;
    const prevBmi = prev ? bmiOf(prev.kg) : null;
    if (!prev || (prevBmi != null && prevBmi >= 18.5)) lsSet(UW_KEY, '');   // תחילת אפיזודה חדשה
    const goalBulk = (function () { try { return S && S.goal === 'bulk'; } catch (e) { return false; } })();
    const decreasing = prev && kg < prev.kg;
    const suppress = goalBulk && !decreasing;                  // מסה + לא-יורד (התחלה/יציב/עולה) → שקט
    if (!suppress && lsGet(UW_KEY) !== '1') {
      lsSet(UW_KEY, '1');
      showToastSafe('המשקל הזה מתחת לטווח המקובל כבריא. אם זה לא מכוון או שמשהו מטריד אותך, שווה להתייעץ עם רופא/ה או דיאטן/ית.', 12000);
    }
  }

  // אם מודל החשבון פתוח על טאב ההתקדמות — מרעננים אותו (שקילה/מחיקה מתוך המודל)
  function refreshOpenProgress() {
    if (!accountEl) return;
    const activeTab = accountEl.querySelector('.account-tab.active');
    const listEl = accountEl.querySelector('.account-list');
    if (listEl && activeTab && activeTab.textContent.indexOf('התקדמות') !== -1) renderProgress(listEl);
  }

  function logWeight(dateStr, rawKg) {
    const kg = clampKg(rawKg);
    if (kg == null) { showToastSafe('משקל לא תקין — הזינו ערך בין 30 ל-300 ק"ג'); return false; }
    const arr = readWeights().filter(w => w.date !== dateStr);
    arr.push({ date: dateStr, kg, saved_at: nowIso() });
    writeWeights(arr);
    if (session) { pendingWeightDeletes.delete(dateStr); pendingWeightUpserts.add(dateStr); markDirty('weight'); }
    underweightReferral(dateStr, kg);
    injectWeightSlot();
    refreshOpenProgress();
    return true;
  }
  function deleteWeight(dateStr) {
    writeWeights(readWeights().filter(w => w.date !== dateStr));
    if (session) { pendingWeightUpserts.delete(dateStr); pendingWeightDeletes.add(dateStr); markDirty('weight'); }
    injectWeightSlot();
    refreshOpenProgress();
  }

  // גרף קו-משקל בק"ג — SVG וניל, מספרי בלבד (בלי הזרקת טקסט משתמש). spark=תקציר בלי צירים.
  function buildWeightSvg(points, opts) {
    opts = opts || {};
    const W = opts.width || 300, H = opts.height || 140, spark = !!opts.spark;
    if (!points.length) return '';
    const kgs = points.map(p => p.kg);
    let lo = Math.min.apply(null, kgs), hi = Math.max.apply(null, kgs);
    if (hi - lo < 1) { lo -= 1; hi += 1; }
    const padX = spark ? 3 : 8, padTop = spark ? 4 : 10, padBot = spark ? 4 : 10;
    const n = points.length;
    const x = i => padX + (n === 1 ? (W - 2 * padX) / 2 : i * (W - 2 * padX) / (n - 1));
    const y = kg => (H - padBot) - (kg - lo) / (hi - lo) * (H - padTop - padBot);
    const coords = points.map((p, i) => [x(i), y(p.kg)]);
    const path = coords.map(c => (c[0]).toFixed(1) + ',' + (c[1]).toFixed(1)).join(' ');
    const dots = coords.map((c, i) =>
      `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(!spark && i === n - 1) ? 4 : (spark ? 2 : 3)}" fill="#4f46e5"/>`).join('');
    const line = n > 1 ? `<polyline points="${path}" fill="none" stroke="#4f46e5" stroke-width="${spark ? 2 : 2.5}" stroke-linejoin="round" stroke-linecap="round"/>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img" aria-label="גרף משקל">${line}${dots}</svg>`;
  }

  // מודל שקילה — קלט מספרי (16px נגד זום iOS, clamp), עם ק"ג ותאריך
  function openWeighInModal(prefillKg, dateStr) {
    const ov = document.createElement('div');
    ov.className = 'auth-overlay weigh-overlay';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    const box = document.createElement('div');
    box.className = 'auth-box weigh-box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const title = document.createElement('h3');
    title.textContent = readWeights().some(w => w.date === (dateStr || todayStr())) ? 'עריכת שקילה' : 'שקילה חדשה';
    const sub = document.createElement('p'); sub.className = 'auth-sub';
    sub.textContent = dateLabel(dateStr || todayStr());
    const input = document.createElement('input');
    input.type = 'number'; input.step = '0.1'; input.min = '30'; input.max = '300';
    input.inputMode = 'decimal'; input.className = 'weigh-input'; input.placeholder = 'משקל בק"ג';
    if (prefillKg) input.value = String(prefillKg);
    const save = document.createElement('button');
    save.className = 'auth-magic'; save.textContent = 'שמירה';
    save.onclick = () => { if (logWeight(dateStr || todayStr(), input.value)) { ov.remove(); showToastSafe('נשמר ✓'); } };
    const cancel = document.createElement('button');
    cancel.className = 'auth-cancel'; cancel.textContent = 'ביטול';
    cancel.onclick = () => ov.remove();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); });
    box.append(title, sub, input, save, cancel);
    ov.appendChild(box); document.body.appendChild(ov);
    setTimeout(() => input.focus(), 50);
  }

  // בונה את תוכן ה-empty-state עם אישור-הזרעה (מחובר בלי שקילות), משותף לסלוט ולטאב
  function seedConfirmEl() {
    const wrap = document.createElement('div'); wrap.className = 'weight-empty';
    const sk = seedKg();
    if (sk) {
      const p = document.createElement('p'); p.className = 'weight-empty-txt';
      p.textContent = '📈 נתחיל מהמשקל שאיתו בנית את התפריט?';
      const val = document.createElement('div'); val.className = 'weight-seed-val';
      val.innerHTML = '<span dir="ltr">' + Number(sk) + '</span> ק"ג · ' + esc(dateLabel(buildWeight()));
      const yes = document.createElement('button');
      yes.className = 'weight-btn primary'; yes.textContent = 'כן, התחל את הגרף';
      yes.onclick = () => { if (logWeight(buildWeight(), sk)) showToastSafe('הגרף התחיל ✓'); };
      const other = document.createElement('button');
      other.className = 'weight-btn'; other.textContent = 'אזין משקל אחר';
      other.onclick = () => openWeighInModal(null, todayStr());
      wrap.append(p, val, yes, other);
    } else {
      const p = document.createElement('p'); p.className = 'weight-empty-txt';
      p.textContent = '📈 הוסיפו שקילה ראשונה כדי להתחיל את הגרף.';
      const add = document.createElement('button');
      add.className = 'weight-btn primary'; add.textContent = '+ שקילה';
      add.onclick = () => openWeighInModal(null, todayStr());
      wrap.append(p, add);
    }
    return wrap;
  }

  // תוכן הסלוט במסך התפריט לפי מצב (אנונימי / מחובר-בלי-נתונים / מחובר-עם-נתונים)
  function weightSlotContent() {
    const card = document.createElement('div'); card.className = 'weight-card';
    if (!session) {
      const p = document.createElement('p'); p.className = 'weight-teaser';
      p.textContent = '📈 רוצה לעקוב אחרי המשקל שלך ולראות את המגמה?';
      const btn = document.createElement('button');
      btn.className = 'weight-btn primary'; btn.textContent = 'התחילו לעקוב · חינם';
      btn.onclick = () => openLogin('עוד רגע ואתם עוקבים 📈 התחברות עם Google או מייל — התפריט שלכם נשמר מיד.');
      card.append(p, btn);
      return card;
    }
    const w = readWeights();
    if (!w.length) { card.appendChild(seedConfirmEl()); return card; }
    // מחובר עם נתונים — מיני-וידג'ט
    const last = w[w.length - 1];
    const prev = w.length > 1 ? w[w.length - 2] : null;
    const top = document.createElement('div'); top.className = 'weight-widget';
    top.onclick = () => openAccountModal('progress');
    const val = document.createElement('span'); val.className = 'weight-last';
    val.innerHTML = '<span dir="ltr">' + Number(last.kg) + '</span> ק"ג';
    top.appendChild(val);
    if (w.length >= 2) {   // sparkline רק כשיש קו; נקודה בודדת = חסר טעם
      const spark = document.createElement('span'); spark.className = 'weight-spark';
      spark.innerHTML = buildWeightSvg(w.slice(-8), { width: 90, height: 30, spark: true });
      top.appendChild(spark);
    }
    const trend = document.createElement('span'); trend.className = 'weight-trend';
    if (prev) {
      const d = Math.round((last.kg - prev.kg) * 10) / 10;
      trend.innerHTML = d === 0 ? 'ללא שינוי' : (d < 0 ? '↓' : '↑') + ' <span dir="ltr">' + Math.abs(d) + '</span> ק"ג';
    } else trend.textContent = 'נקודה ראשונה';
    top.appendChild(trend);
    const add = document.createElement('button');
    add.className = 'weight-btn' + ((weeksDue() && !todayWeighed()) ? ' primary' : '');
    add.textContent = addBtnLabel();
    add.onclick = () => openWeighInModal(last.kg, todayStr());
    const row = document.createElement('div'); row.className = 'weight-widget-row';
    row.append(top, add);
    card.appendChild(row);
    return card;
  }

  function injectWeightSlot() {
    const host = document.getElementById('menu-output');
    if (!host) return;
    const old = host.querySelector('#weight-slot');
    if (old) old.remove();
    const summary = host.querySelector('.summary-card');
    if (!summary) return;
    const el = weightSlotContent(); el.id = 'weight-slot';
    summary.insertAdjacentElement('afterend', el);
  }

  // תוכן טאב "התקדמות" במודל החשבון — הגרף המלא + רשימת שקילות (עריכה/מחיקה)
  function renderProgress(listEl) {
    listEl.innerHTML = '';
    const w = readWeights();
    if (!w.length) { listEl.appendChild(seedConfirmEl()); return; }
    const graph = document.createElement('div'); graph.className = 'weight-graph';
    graph.innerHTML = buildWeightSvg(w, { width: 320, height: 150 });
    const range = document.createElement('div'); range.className = 'weight-range';
    // בלי טווח מספר–מספר (מתהפך ב-RTL); ספירה בלבד + אחרון מבודד-LTR
    const cnt = w.length === 1 ? 'שקילה אחת' : w.length + ' שקילות';
    range.innerHTML = cnt + ' · אחרון <span dir="ltr">' + Number(w[w.length - 1].kg) + '</span> ק"ג'
      + (w.length === 1 ? '<br><span class="weight-hint">שקילה נוספת ביום אחר תיצור קו מגמה 📈</span>' : '');
    const addBtn = document.createElement('button');
    addBtn.className = 'weight-btn primary weight-add-full';
    addBtn.textContent = addBtnLabel();
    addBtn.onclick = () => openWeighInModal(w[w.length - 1].kg, todayStr());
    listEl.append(graph, range, addBtn);
    w.slice().reverse().forEach(p => {
      const row = document.createElement('div'); row.className = 'account-row weight-row';
      const del = document.createElement('button'); del.className = 'row-del'; del.textContent = '✕';
      del.title = 'מחיקת שקילה';
      del.onclick = e => { e.stopPropagation(); deleteWeight(p.date); renderProgress(listEl); showToastSafe('נמחק'); };
      const dd = document.createElement('span'); dd.className = 'row-date'; dd.textContent = dateLabel(p.date);
      const kg = document.createElement('span'); kg.className = 'row-meta'; kg.textContent = p.kg + ' ק"ג';
      row.append(del, dd, kg);
      row.onclick = () => openWeighInModal(p.kg, p.date);
      listEl.appendChild(row);
    });
  }
  // חשיפה פנימית (namespace תת-קו) — לרינדור מהמודל ולבדיקות/אינטגרציה עתידית
  window._shapeatWeight = { renderProgress, injectWeightSlot, logWeight, deleteWeight, readWeights, bmiOf };

  // ══════════ init ══════════
  sb.auth.onAuthStateChange((evt, sess) => {
    session = sess;
    updateAccountBtn();
    try { injectWeightSlot(); } catch (e) {}   // הסלוט משתנה בין אנונימי למחובר
    if (evt === 'SIGNED_IN') {
      closeLogin(); hideBanner();
      if (!lsGet('shapeat-signup-sent')) { lsSet('shapeat-signup-sent', '1'); track('signup'); }
      firstMerge();
      // מימוש כוונת-שמירה ששרדה את ה-redirect (בתוך חלון הזמן בלבד)
      const fi = parseInt(lsGet(FAV_INTENT_KEY), 10);
      lsSet(FAV_INTENT_KEY, '');
      if (fi && Date.now() - fi < FAV_INTENT_MS) { try { window.saveFavorite(); } catch (e) {} }
      // כוונת-חיבור למאמנת ששרדה את ה-redirect — אותו דפוס, חלון זמן זהה
      const ji = parse(lsGet(JOIN_KEY));
      lsSet(JOIN_KEY, '');
      if (ji && ji.invite && Date.now() - ji.ts < JOIN_MS) { doJoin(ji); }
    }
    if (evt === 'SIGNED_OUT') closeAccountModal();
    if (evt === 'INITIAL_SESSION' && sess) pull();
    if (sess) syncCoachBrand();   // מיתוג לפי הקישור בדאטהבייס, בכל כניסה
  });

  // חשיפה מינימלית ל-UI (האייקון בכותרת משתמש בזה; שמור תאימות לקוד קיים)
  window.shapeatAccount = {
    login:  openLogin,
    openAccount: openAccountModal,
    logout: () => sb.auth.signOut(),
    deleteAccount: async () => {
      await sb.rpc('delete_my_account');
      await sb.auth.signOut();
      try { localStorage.removeItem(META_KEY); localStorage.removeItem('shapeat-signup-sent'); } catch (e) {}
    },
    isConnected: () => !!session,
    join: openJoin,
    revokeCoach,
  };

  // יום ראשון של שימוש נרשם; הבאנר יופיע רק מהיום השני / השלמת יום
  if (!lsGet('shapeat-first-seen')) lsSet('shapeat-first-seen', todayStr());
  injectAccountBtn();
  setTimeout(maybeShowBanner, 1500);

  // ?join=<invite> — לינק ההזמנה של המאמנת. פותח את מסך ההסכמה בלבד, לא מחבר.
  // מנקים מיד מה-URL כדי שרענון או שיתוף של הכתובת לא יפתחו אותו שוב.
  try {
    const jp = new URLSearchParams(location.search).get('join');
    if (jp && /^[0-9a-f-]{36}$/i.test(jp)) {
      history.replaceState(null, '', location.pathname + location.hash);
      setTimeout(() => openJoin(jp), 400);
    }
  } catch (e) {}
})();
