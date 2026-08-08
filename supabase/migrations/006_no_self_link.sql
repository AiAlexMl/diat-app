-- ============================================================
-- 006_no_self_link.sql — מאמנת לא מתחברת כמתאמנת של עצמה
-- הרצה: Supabase Studio → SQL Editor (אחרי 005).
--
-- הבעיה: לינק ההזמנה הוא כתובת רגילה, ואין מה שמונע מהמאמנת לפתוח את שלה.
-- היא הייתה מופיעה ברשימת המתאמנות של עצמה ומנפחת לעצמה את המונה ב-1.
-- לא מסוכן, אבל מרושל, ובשלב הלוח (3) ספירה מנופחת מתחילה להיות שווה משהו.
--
-- שים לב שהתנאי עובד *בזכות* ה-RLS ולא למרותו:
-- coaches_select_own מתיר לקרוא רק את שורתך שלך. לכן אצל מתאמנת רגילה
-- ה-exists לא מוצא כלום (השורה מוסתרת) והחיבור עובר; אצל המאמנת עצמה
-- הוא מוצא את שורתה ונחסם. אין צורך בפונקציית DEFINER נוספת.
-- ============================================================

drop policy if exists coach_links_insert_trainee on coach_links;
create policy coach_links_insert_trainee on coach_links
  for insert with check (
    auth.uid() = trainee_id
    and is_approved_coach(coach_id)
    and not exists (
      select 1 from coaches c where c.id = coach_id and c.user_id = auth.uid()
    )
  );
