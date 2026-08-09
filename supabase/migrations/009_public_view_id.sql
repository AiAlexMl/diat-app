-- ============================================================
-- 009_public_view_id.sql — חשיפת id ב-coaches_public
-- הרצה: Supabase Studio → SQL Editor (אחרי 008).
--
-- למה: האפליקציה צריכה למשוך את מיתוג המאמנת לפי coach_id שכתוב בקישור של
-- המתאמנת. הצירוף הישיר לטבלת coaches חסום ע"י RLS (רק הבעלים קורא את שורתו),
-- ו-coaches_public לא חשף id ולכן אי אפשר היה להתאים. בלי זה מתאמנת רגילה
-- לא הייתה מקבלת מיתוג לעולם. (נמצא 09/08/2026)
--
-- ה-id הוא UUID של פרופיל מאמן מאושר, והמתאמנת מחזיקה אותו ממילא ב-coach_links.
-- אין כאן חשיפה חדשה של מידע.
-- ============================================================
drop view if exists coaches_public;

create view coaches_public
  with (security_invoker = off) as
  select id, slug, display_name, tagline, brand_color, logo_path, logo_version, niche
  from coaches where status = 'approved';

grant select on coaches_public to anon, authenticated;
