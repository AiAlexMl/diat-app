-- ============================================================
-- 005_coaches_fix.sql — תיקון שני באגים ב-004, שנתפסו ע"י rls-test ב-08/08/2026
-- הרצה: Supabase Studio → SQL Editor (אחרי 004).
--
-- שניהם מאותו סוג: הגנה שחוסמת גם את מי שאמורה לעבור דרכה.
-- ============================================================

-- ── באג 1: coaches_guard_columns חוסם את claim_coach ו-rotate_invite ──
-- שתי הפונקציות משנות user_id/invite_code, וזה בדיוק מה שהטריגר אוסר.
-- טריגר רץ תמיד, גם בתוך SECURITY DEFINER, ולכן claim_coach נכשל ב-'protected column'
-- והמאמנת מעולם לא תבעה חשבון. משם כל שאר הבדיקות נפלו כדומינו.
--
-- הפתרון: דגל טרנזקציוני שרק הפונקציות המורשות מדליקות. הוא local=true, כלומר
-- מת בסוף הטרנזקציה ואי אפשר "להשאיר אותו דלוק" מהלקוח.
create or replace function coaches_guard_columns() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.coach_admin', true), '') = '1' then
    return new;   -- claim_coach / rotate_invite — מסלול מורשה ומפורש
  end if;
  if new.slug        is distinct from old.slug        or
     new.status      is distinct from old.status      or
     new.tier        is distinct from old.tier        or
     new.invite_code is distinct from old.invite_code or
     new.user_id     is distinct from old.user_id then
    raise exception 'protected column';
  end if;
  return new;
end $$;

create or replace function claim_coach(invite uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare rows_hit int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform set_config('app.coach_admin', '1', true);   -- true = טרנזקציוני בלבד
  update public.coaches
     set user_id = auth.uid(), invite_code = gen_random_uuid()   -- הקוד נשרף מיד
   where invite_code = invite and user_id is null;
  get diagnostics rows_hit = row_count;
  if rows_hit = 0 then raise exception 'invalid or used invite'; end if;
end $$;

create or replace function rotate_invite() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare fresh uuid;
begin
  perform set_config('app.coach_admin', '1', true);
  update public.coaches set invite_code = gen_random_uuid()
   where user_id = auth.uid()
   returning invite_code into fresh;
  if fresh is null then raise exception 'not a coach'; end if;
  return fresh;
end $$;

-- ── באג 2: policy ה-INSERT על coach_links חוסמת את עצמה ──
-- היא בודקת `exists (select 1 from coaches where id = coach_id and status='approved')`,
-- אבל RLS על coaches מתיר למשתמש לקרוא רק את *שורתו שלו*. המתאמנת קוראת שורה של
-- מאמנת, מקבלת 0, וה-check נכשל — "new row violates row-level security policy".
--
-- הפתרון: עוזר DEFINER זעיר שמחזיר בוליאני בלבד. הוא לא חושף שום שדה,
-- ולכן אינו מרחיב את משטח החשיפה של טבלת coaches.
create or replace function is_approved_coach(cid uuid) returns boolean
language sql security definer set search_path = '' stable
as $$
  select exists (select 1 from public.coaches c where c.id = cid and c.status = 'approved');
$$;

revoke execute on function is_approved_coach(uuid) from public;
grant execute on function is_approved_coach(uuid) to authenticated;

drop policy if exists coach_links_insert_trainee on coach_links;
create policy coach_links_insert_trainee on coach_links
  for insert with check (
    auth.uid() = trainee_id
    and is_approved_coach(coach_id)
  );

-- הערה: שאר ה-policies (select/revoke על coach_links, select על day_summaries)
-- קוראות מ-coaches רק את שורת *המאמנת המחוברת*, וזה מותר תחת coaches_select_own.
-- לכן הן תקינות ולא נגענו בהן.
