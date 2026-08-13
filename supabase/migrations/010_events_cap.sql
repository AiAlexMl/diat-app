-- ============================================================
-- 010_events_cap.sql — תקרת שורות ל-events + פונקציית בריאות
-- הרצה: Supabase Studio → SQL Editor (אחרי 009).
--
-- הבעיה (נמצא בסקירת אבטחה 13/08/2026):
-- `events_insert_any` מתיר INSERT ל-anon עם `with check (true)`. המפתח הציבורי
-- נמצא בקוד הלקוח כמתוכנן, ולכן **כל אחד יכול לכתוב שורות בלי הגבלה**. ה-throttle
-- שלנו הוא בצד הלקוח ולתוקף אין סיבה לכבד אותו.
-- הנזק אינו דליפה אלא **השבתה**: מילוי 500MB של ה-free tier ⇒ כתיבות של
-- משתמשים אמיתיים (day_logs, favorites, weight_logs) מתחילות להיכשל.
-- ⚠️ ואין נקודת חסימה בקצה: התקיפה פונה ישירות למארח של Supabase, שאינו מאחורי
--    ה-Cloudflare של shapeat.co.il.
--
-- ההכרעה (אלכס, 13/08/2026):
-- 1. `events` היא **אות רך בלבד**. מספרים שיוצגו לחברות מזון ייבנו ממקור אחר
--    (profiles/day_summaries) שמאומת בשרת ואי אפשר לזייף מבחוץ. טבלה שפתוחה
--    לכתיבה אנונימית ומספר שמוכרים עליו לא יכולים להתקיים יחד.
-- 2. בתקרה **דוחים כתיבות ולא מוחקים ישנות**: מחיקה נכשלת בשקט ומוחקת היסטוריה
--    אמיתית, ודחייה נכשלת ברעש — וזה מה שרוצים מתקיפה.
-- ============================================================

-- ── 1. תקרה ──
-- 200,000 שורות ≈ 40MB מתוך 500. אחרי חודשיים של שימוש אמיתי יש 290 שורות,
-- כלומר התקרה בלתי נראית בשימוש רגיל ורלוונטית רק תחת תקיפה.
-- ספירה מלאה בכל INSERT היא יקרה, ולכן משתמשים בהערכת המתכנן (reltuples),
-- שמתעדכנת ב-autovacuum ומספיקה לחלוטין לסף גס.
create or replace function events_cap() returns trigger
language plpgsql as $$
declare est bigint;
begin
  select reltuples::bigint into est from pg_class where oid = 'public.events'::regclass;
  if est > 200000 then
    raise exception 'events cap reached';
  end if;
  return new;
end $$;

drop trigger if exists events_cap_trg on events;
create trigger events_cap_trg
  before insert on events
  for each row execute function events_cap();

-- ── 2. פונקציית בריאות ──
-- מחזירה **מספרים בלבד**, אף פעם לא שורות. זה מה שמאפשר ל-keepalive לבדוק
-- אותה עם המפתח הציבורי בלבד, בלי שום סוד ב-GitHub.
-- ל-events אין policy ל-SELECT בכוונה, ולכן היא חייבת להיות SECURITY DEFINER.
-- היקף הביקורת שלה זעיר: שתי ספירות, בלי פרמטרים, בלי גישה לשום דבר אחר.
create or replace function events_health()
  returns table (total bigint, last_hour bigint)
language sql security definer set search_path = '' stable
as $$
  select (select count(*) from public.events),
         (select count(*) from public.events where created_at > now() - interval '1 hour');
$$;

revoke execute on function events_health() from public;
grant execute on function events_health() to anon, authenticated;
