/* ══════════════════════════════════════════
   rls-test.mjs — בדיקת RLS מעשית
   שלב 1: profiles / day_logs / favorites / weight_logs / events
   שלב 2 (004): coaches / coach_links / day_summaries / coach_weight_trend
   רץ לפני כל מיגרציה חדשה.

   ⚠️ מיגרציה חדשה = בלוק בדיקה חדש כאן, באותו commit. weight_logs (003) חמקה
   מזה וישבה ללא כיסוי עד 29/07/2026, ודווקא היא הטבלה הרגישה ביותר.

   ✅ הורץ 14/08/2026 אחרי 009+010 — **הכל ירוק**, כולל שלוש הבדיקות החדשות
      ל-`events`: המספרים נגישים ל-anon דרך `events_health`, והטבלה עצמה עדיין
      אטומה לקריאה. זו ההרצה הראשונה שמכסה את 009 (שינתה view ציבורי).
   ✅ הורץ מול הפרויקט החי 29/07/2026 — כל בדיקות שלב 1 עברו.
   ✅ הורץ שוב 09/08/2026 אחרי 006+007+008 — הכל ירוק. אימת גם את מנעול
      ההתחברות-לעצמך (006) וגם ששינוי חתימת coach_roster (008, רצועת 14 יום
      במקום אחוז) לא שבר את שדות המשקל.
   ✅ הורץ 08/08/2026 אחרי 004+005 — הכל ירוק, כולל בלוק המאמנים.
      בהרצה הראשונה (004 בלבד) נפלו 9 בדיקות וחשפו שני באגים אמיתיים:
      הטריגר על coaches חסם את claim_coach, ו-policy ה-INSERT על coach_links
      חסמה את עצמה כי היא קראה שורת coaches שה-RLS לא מתיר למתאמנת. תוקן ב-005.
      ⇒ בלי הבדיקה, המאמנת האמיתית הראשונה הייתה נתקלת ב"החשבון אינו מחובר לפרופיל מאמן".

   🔑 שתי הבדיקות שכל שכבת המאמנים עומדת עליהן, ומסומנות בקובץ ב-🔑:
      מאמנת שמנסה day_logs → 0 שורות, ומאמנת שמנסה weight_logs → 0 שורות.
      אם אחת מהן נכשלת — לא מחברים אף מאמנת אמיתית עד שהיא ירוקה.

   🔑 המפתח הסודי: ליצור מפתח `sb_secret_` חד-פעמי בדשבורד לפני ההרצה ולמחוק
   אותו מיד אחריה. כרטיס חד-פעמי במקום סוד שצריך לנהל: גם אם ידלוף, הוא כבר מת.
   ב-PowerShell להריץ שורה-שורה (`$env:X = Read-Host`), לא כבלוק מודבק — פרומפט
   אינטראקטיבי בתוך בלוק בולע את השורה הבאה כקלט.

   הרצה (המפתחות לא נשמרים בשום קובץ — משתני סביבה בלבד):
     SUPABASE_URL=https://xxx.supabase.co \
     SUPABASE_ANON_KEY=eyJ... \
     SUPABASE_SERVICE_KEY=eyJ... \
     node supabase/tests/rls-test.mjs
   ══════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('חסרים משתני סביבה: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// ── משתמשי בדיקה חד-פעמיים (נמחקים בסוף) ──
const PASS = 'rls-test-' + crypto.randomUUID();
async function makeUser(tag) {
  const email = `rls-test-${tag}-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASS, email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw new Error(`signIn ${tag}: ${e2.message}`);
  return { id: data.user.id, client };
}

const today = new Date().toLocaleDateString('en-CA');
let a, b;

try {
  a = await makeUser('a');
  b = await makeUser('b');

  // ── הכנה: לכל מתאמן פרופיל ויום ──
  for (const u of [a, b]) {
    const { error: pe } = await u.client.from('profiles')
      .upsert({ id: u.id, prefs: { goal: 'maintain' }, prefs_updated_at: new Date().toISOString() });
    check(`מתאמן כותב profile לעצמו (${u === a ? 'א' : 'ב'})`, !pe, pe?.message);
    const { error: de } = await u.client.from('day_logs').upsert({
      trainee_id: u.id, date: today,
      payload: { date: today, meals: [] }, client_updated_at: new Date().toISOString(),
    });
    check(`מתאמן כותב day_log לעצמו (${u === a ? 'א' : 'ב'})`, !de, de?.message);
  }

  // ── 1. בידוד בין מתאמנים: א' לא רואה כלום של ב' ──
  const { data: p } = await a.client.from('profiles').select('*').eq('id', b.id);
  check("מתאמן א' לא קורא profile של ב' (0 שורות)", (p || []).length === 0);
  const { data: d } = await a.client.from('day_logs').select('*').eq('trainee_id', b.id);
  check("מתאמן א' לא קורא day_logs של ב' (0 שורות)", (d || []).length === 0);

  // ── 2. א' לא כותב בשם ב' ──
  const { error: w1 } = await a.client.from('day_logs').upsert({
    trainee_id: b.id, date: today,
    payload: { date: today, meals: [] }, client_updated_at: new Date().toISOString(),
  });
  check("מתאמן א' לא כותב day_log בשם ב'", !!w1);
  const { error: w2 } = await a.client.from('profiles')
    .update({ prefs: { hacked: true } }).eq('id', b.id);
  // update על שורה לא-נגישה = 0 שורות מושפעות (RLS מסנן) — נוודא שלא השתנה בפועל
  const { data: bp } = await b.client.from('profiles').select('prefs').eq('id', b.id).single();
  check("prefs של ב' לא השתנה מניסיון עדכון של א'", !bp.prefs.hacked, w2?.message);

  // ── 2ב. favorites: עצמי עובד, של אחר חסום ──
  const favId = crypto.randomUUID();
  const { error: f1 } = await a.client.from('favorites').upsert({
    trainee_id: a.id, fav_id: favId, date: today,
    saved_at: new Date().toISOString(), payload: { date: today, meals: [] },
  });
  check("מתאמן א' כותב מועדף לעצמו", !f1, f1?.message);
  const { error: f2 } = await a.client.from('favorites').upsert({
    trainee_id: a.id, fav_id: favId, date: today,
    saved_at: new Date().toISOString(), payload: { date: today, meals: [], v: 2 },
  });
  check("מתאמן א' מעדכן מועדף קיים (upsert)", !f2, f2?.message);
  const { data: bf } = await b.client.from('favorites').select('*').eq('trainee_id', a.id);
  check("מתאמן ב' לא קורא מועדפים של א' (0 שורות)", (bf || []).length === 0);
  const { error: f3 } = await b.client.from('favorites').upsert({
    trainee_id: a.id, fav_id: crypto.randomUUID(), date: today,
    saved_at: new Date().toISOString(), payload: {},
  });
  check("מתאמן ב' לא כותב מועדף בשם א'", !!f3);
  const { error: f4 } = await a.client.from('favorites')
    .delete().eq('trainee_id', a.id).eq('fav_id', favId);
  const { data: af } = await a.client.from('favorites').select('fav_id').eq('trainee_id', a.id);
  check("מתאמן א' מוחק מועדף שלו", !f4 && (af || []).length === 0, f4?.message);

  // ── 2ג. weight_logs: עצמי עובד, של אחר חסום, ורצפות השפיות של ה-DB ──
  // הטבלה הכי רגישה שיש (היסטוריית משקל = מידע בריאותי, תיקון 13) והיא נוספה
  // במיגרציה 003 אחרי שהקובץ הזה נכתב, כלומר ה-RLS שלה מעולם לא נבדק בפועל.
  const nowIso = () => new Date().toISOString();
  const { error: k1 } = await a.client.from('weight_logs').upsert({
    trainee_id: a.id, date: today, weight_kg: 80.5, client_updated_at: nowIso(),
  });
  check("מתאמן א' כותב שקילה לעצמו", !k1, k1?.message);
  const { error: k2 } = await a.client.from('weight_logs').upsert({
    trainee_id: a.id, date: today, weight_kg: 80.1, client_updated_at: nowIso(),
  });
  check("מתאמן א' מעדכן שקילה קיימת (upsert לפי תאריך)", !k2, k2?.message);

  // שקילה ל-ב' — גם כהכנה לבדיקת ה-cascade בסעיף 5
  const { error: k3 } = await b.client.from('weight_logs').upsert({
    trainee_id: b.id, date: today, weight_kg: 62.0, client_updated_at: nowIso(),
  });
  check("מתאמן ב' כותב שקילה לעצמו", !k3, k3?.message);

  const { data: bw } = await b.client.from('weight_logs').select('*').eq('trainee_id', a.id);
  check("מתאמן ב' לא קורא שקילות של א' (0 שורות)", (bw || []).length === 0);
  const { error: k4 } = await b.client.from('weight_logs').upsert({
    trainee_id: a.id, date: today, weight_kg: 99.9, client_updated_at: nowIso(),
  });
  check("מתאמן ב' לא כותב שקילה בשם א'", !!k4);
  // update על שורה לא-נגישה מסונן ע"י RLS (0 שורות) — מוודאים שהערך לא זז בפועל
  await b.client.from('weight_logs').update({ weight_kg: 1.0 }).eq('trainee_id', a.id);
  const { data: aw } = await a.client.from('weight_logs')
    .select('weight_kg').eq('trainee_id', a.id).eq('date', today).single();
  check("המשקל של א' לא השתנה מניסיון עדכון של ב'", Number(aw.weight_kg) === 80.1);
  await b.client.from('weight_logs').delete().eq('trainee_id', a.id);
  const { data: aw2 } = await a.client.from('weight_logs').select('date').eq('trainee_id', a.id);
  check("מתאמן ב' לא מוחק שקילות של א'", (aw2 || []).length === 1);

  // check ברמת DB: 20–400 ק"ג (רחב מה-clamp בלקוח 30–300)
  const { error: k5 } = await a.client.from('weight_logs').upsert({
    trainee_id: a.id, date: '2026-01-02', weight_kg: 500, client_updated_at: nowIso(),
  });
  check('שקילה מחוץ לטווח (500 ק"ג) נדחית ברמת ה-DB', !!k5);
  // trigger check_weight_date — זהה ל-day_logs
  const farW = new Date(Date.now() + 5 * 864e5).toLocaleDateString('en-CA');
  const { error: k6 } = await a.client.from('weight_logs').upsert({
    trainee_id: a.id, date: farW, weight_kg: 80, client_updated_at: nowIso(),
  });
  check('שקילה עם תאריך עתידי (+5 ימים) נדחית', !!k6);

  const { error: k7 } = await a.client.from('weight_logs')
    .delete().eq('trainee_id', a.id).eq('date', today);
  const { data: aw3 } = await a.client.from('weight_logs').select('date').eq('trainee_id', a.id);
  check("מתאמן א' מוחק שקילה שלו", !k7 && (aw3 || []).length === 0, k7?.message);

  // ── 3. events: כתיבה פתוחה, קריאה חסומה ──
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: ee } = await anon.from('events').insert({
    event_type: 'menu_built', anon_id: crypto.randomUUID(),
  });
  check('anon כותב event (insert-only)', !ee, ee?.message);
  const { data: ev } = await anon.from('events').select('*').limit(1);
  check('anon לא קורא events (0 שורות)', (ev || []).length === 0);
  const { error: badType } = await anon.from('events').insert({
    event_type: 'not-in-whitelist', anon_id: crypto.randomUUID(),
  });
  check('event מחוץ ל-whitelist נדחה', !!badType);
  const { error: ms } = await anon.from('events').insert({
    event_type: 'menu_saved', anon_id: crypto.randomUUID(),
  });
  check("event מסוג menu_saved עובר (מיגרציה 002)", !ms, ms?.message);

  // ── 4. תאריך עתידי נדחה (trigger, סובלנות יום) ──
  const far = new Date(Date.now() + 5 * 864e5).toLocaleDateString('en-CA');
  const { error: fe } = await a.client.from('day_logs').upsert({
    trainee_id: a.id, date: far,
    payload: { date: far, meals: [] }, client_updated_at: new Date().toISOString(),
  });
  check('day_log עם תאריך עתידי (+5 ימים) נדחה', !!fe);

  // ══════════════════════════════════════════════════════════
  // 4ב. שכבת המאמנים (מיגרציה 004)
  // המבחנים הקריטיים: מאמנת לא מגיעה ל-day_logs ולא ל-weight_logs, בשום מסלול.
  // ══════════════════════════════════════════════════════════
  const coach = await makeUser('coach');
  const inviteCode = crypto.randomUUID();
  const { data: crow, error: ce } = await admin.from('coaches').insert({
    slug: 'rls-test-' + Date.now().toString(36),
    display_name: 'מאמנת בדיקה', status: 'approved', invite_code: inviteCode,
  }).select('id').single();
  check('service_role יוצר שורת coaches', !ce, ce?.message);

  const { error: cl } = await coach.client.rpc('claim_coach', { invite: inviteCode });
  check('claim_coach תובע את החשבון', !cl, cl?.message);
  const { error: cl2 } = await coach.client.rpc('claim_coach', { invite: inviteCode });
  check('claim_coach שני נכשל (הקוד נשרף)', !!cl2);

  // א' מתחבר בלי שיתוף משקל; ב' מתחבר *עם* שיתוף, ועם consent_at מלפני 10 ימים
  // כדי שיהיו לו שתי שקילות בתוך החלון (ההסכמה לא פותחת עבר — ראו הערה למטה).
  const { error: li1 } = await a.client.from('coach_links').insert({
    trainee_id: a.id, coach_id: crow.id, trainee_display_name: 'מתאמנת א',
    trainee_goal: 'cut', share_weight: false, consent_text_version: 1,
  });
  check("מתאמן א' יוצר קישור לעצמו", !li1, li1?.message);

  const { error: li2 } = await a.client.from('coach_links').insert({
    trainee_id: b.id, coach_id: crow.id, trainee_display_name: 'התחזות',
    trainee_goal: 'cut', share_weight: true, consent_text_version: 1,
  });
  check("מתאמן א' לא יוצר קישור בשם ב'", !!li2);

  const past = new Date(Date.now() - 10 * 864e5).toISOString();
  await admin.from('coach_links').insert({
    trainee_id: b.id, coach_id: crow.id, trainee_display_name: 'מתאמנת ב',
    trainee_goal: 'maintain', share_weight: true, consent_text_version: 1, consent_at: past,
  });
  const older = new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA');
  await b.client.from('weight_logs').upsert({
    trainee_id: b.id, date: older, weight_kg: 72.5, client_updated_at: new Date().toISOString(),
  });

  for (const u of [a, b]) {
    await u.client.from('day_summaries').upsert({
      trainee_id: u.id, date: today, meals_planned: 4, meals_eaten: 3, completed: false,
    });
  }

  // 🔑 שני המבחנים שכל השכבה הזאת עומדת עליהם
  const { data: spy1 } = await coach.client.from('day_logs').select('*');
  check('🔑 מאמנת מנסה day_logs → 0 שורות', (spy1 || []).length === 0);
  const { data: spy2 } = await coach.client.from('weight_logs').select('*');
  check('🔑 מאמנת מנסה weight_logs → 0 שורות', (spy2 || []).length === 0);

  const { data: sums } = await coach.client.from('day_summaries').select('trainee_id');
  check('מאמנת קוראת day_summaries של מקושרות', (sums || []).length === 2, `got ${(sums || []).length}`);

  const { data: roster, error: re } = await coach.client.rpc('coach_roster');
  check('coach_roster מחזיר את שתי המקושרות', !re && (roster || []).length === 2, re?.message);
  const ra = (roster || []).find(r => r.trainee_id === a.id);
  const rb = (roster || []).find(r => r.trainee_id === b.id);
  check("share_weight=false ⇒ אין שום שדה משקל ל-א'", !!ra && ra.weight_delta == null && ra.weight_shape == null);
  check("share_weight=true ⇒ יש מגמה ל-ב'", !!rb && rb.weight_delta != null);
  check('המגמה היא הפרש בלבד, וה-shape מנורמל 0-1',
    !rb || (rb.weight_shape || []).every(v => Number(v) >= 0 && Number(v) <= 1));

  // 🔑 קריאה ישירה ל-DEFINER, עוקפת את הממשק
  const { data: wt1 } = await coach.client.rpc('coach_weight_trend', { trainee: a.id });
  check('🔑 coach_weight_trend על מי שלא שיתפה → ריק', (wt1 || []).length === 0);
  const { data: wt2 } = await coach.client.rpc('coach_weight_trend', { trainee: b.id });
  check('coach_weight_trend על מי ששיתפה → מחזיר', (wt2 || []).length === 1);
  const { data: wt3 } = await a.client.rpc('coach_weight_trend', { trainee: b.id });
  check('🔑 מתאמנת קוראת coach_weight_trend על אחרת → ריק', (wt3 || []).length === 0);

  // המאמנת מסירה (הכרעת 08/08: בלי תור אישורים, אבל עם יכולת הסרה)
  const { error: rv } = await coach.client.from('coach_links')
    .update({ status: 'revoked' }).eq('trainee_id', a.id).eq('status', 'active');
  check('מאמנת מסירה מתאמנת (active → revoked)', !rv, rv?.message);
  const { data: after } = await coach.client.rpc('coach_roster');
  check('אחרי ההסרה היא נעלמת מהרשימה מיידית', (after || []).length === 1);
  const { data: sums2 } = await coach.client.from('day_summaries').select('trainee_id').eq('trainee_id', a.id);
  check("אחרי ההסרה אין גישה לסיכומים של א'", (sums2 || []).length === 0);

  const { error: bad } = await coach.client.from('coaches')
    .update({ tier: 'elite' }).eq('id', crow.id);
  check('מאמנת לא משנה tier לעצמה (trigger)', !!bad);

  // 006: המאמנת פותחת את לינק ההזמנה של עצמה — לא אמורה להיכנס לרשימה שלה
  await admin.from('profiles').upsert({ id: coach.id });
  const { error: self } = await coach.client.from('coach_links').insert({
    trainee_id: coach.id, coach_id: crow.id, trainee_display_name: 'אני',
    trainee_goal: 'cut', share_weight: false, consent_text_version: 1,
  });
  check('מאמנת לא מתחברת כמתאמנת של עצמה (006)', !!self);

  // ── 4ב. events: תקרה + פונקציית בריאות (010) ──
  // events פתוחה לכתיבה ל-anon בכוונה (מדידת משתמש אנונימי), ולכן ההגנה היא
  // תקרה ולא הרשאה. הבדיקה כאן היא ש**המספרים נגישים בלי סוד** ושהטבלה עצמה
  // עדיין אטומה לקריאה — זה מה שמאפשר ל-keepalive להתריע בלי service_role.
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: eh, error: ehErr } = await anonC.rpc('events_health');
  const row = Array.isArray(eh) ? eh[0] : eh;
  check('events_health נגישה ל-anon', !ehErr, ehErr?.message);
  check('events_health מחזירה מספרים בלבד',
    !!row && typeof row.total === 'number' && typeof row.last_hour === 'number' &&
    Object.keys(row).length === 2);
  const { data: rawEv } = await anonC.from('events').select('*').limit(1);
  check('🔑 anon עדיין לא קורא שורות מ-events', (rawEv || []).length === 0);

  // ── 5. delete_my_account: מוחק את המשתמש וכל הדאטה ──
  const { error: da } = await b.client.rpc('delete_my_account');
  check('delete_my_account רץ למשתמש מחובר', !da, da?.message);
  const { data: gone } = await admin.from('profiles').select('id').eq('id', b.id);
  check('ה-cascade מחק את ה-profile', (gone || []).length === 0);
  const { data: goneW } = await admin.from('weight_logs').select('date').eq('trainee_id', b.id);
  check('ה-cascade מחק גם את ה-weight_logs', (goneW || []).length === 0);
  b = null;   // כבר נמחק
} catch (e) {
  console.error('✗ שגיאה קשה:', e.message);
  failures++;
} finally {
  // ── ניקוי ──
  for (const u of [a, b, typeof coach !== 'undefined' ? coach : null].filter(Boolean)) {
    try { await admin.auth.admin.deleteUser(u.id); } catch (e) {}
  }
  try { await admin.from('coaches').delete().like('slug', 'rls-test-%'); } catch (e) {}
}

console.log(failures === 0 ? '\nכל בדיקות ה-RLS עברו ✓' : `\n${failures} בדיקות נכשלו ✗`);
process.exit(failures === 0 ? 0 : 1);
