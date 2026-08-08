-- ============================================================
-- 004_coaches.sql — שלב 2: חיבור מתאמנת-מאמנת בהסכמה + דשבורד
-- לפי internal/ARCHITECTURE-COACHES.md (המסמך המחייב), עם הכרעות ה-grilling מ-08/08/2026.
-- הרצה: Supabase Studio → SQL Editor.
--
-- ⚠️ עקרון-העל של הקובץ הזה: מה שהמאמנת לא אמורה לראות — אין לה policy אליו.
--    day_logs ו-weight_logs נשארים ללא policy למאמנת. חסימה מבנית, לא סינון עמודות.
-- ============================================================

-- ============ coaches ============
create table coaches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users(id),  -- NULL עד שהמאמנת "תובעת" את החשבון
  slug          text unique not null
                check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),  -- ASCII בלבד: URL עברי נשבר בהעתקות
  display_name  text not null check (char_length(display_name) between 2 and 40),
  tagline       text check (char_length(tagline) <= 80),
  brand_color   text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),      -- regex = הגנת CSS injection
  logo_path     text,
  logo_version  int not null default 1,
  niche         text,
  status        text not null default 'pending'
                check (status in ('pending','approved','suspended')),
  tier          text not null default 'free'
                check (tier in ('free','pro','elite')),   -- עוגן; אין אכיפה עד שלב 4
  invite_code   uuid unique not null default gen_random_uuid(),  -- claim + טוקן ההזמנה למתאמנות
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index coaches_status_idx on coaches(status);

alter table coaches enable row level security;

-- המאמנת רואה את שורתה המלאה בלבד. הציבור קורא דרך coaches_public (למטה).
create policy coaches_select_own on coaches
  for select using (auth.uid() = user_id);
-- INSERT רק service_role (אלכס יוצר ידנית ב-Studio) — אין policy, וזה מכוון.
create policy coaches_update_own on coaches
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trigger: המאמנת לא משנה slug/status/tier/invite_code/user_id דרך UPDATE רגיל
create or replace function coaches_guard_columns() returns trigger
language plpgsql as $$
begin
  if new.slug        is distinct from old.slug        or
     new.status      is distinct from old.status      or
     new.tier        is distinct from old.tier        or
     new.invite_code is distinct from old.invite_code or
     new.user_id     is distinct from old.user_id then
    raise exception 'protected column';
  end if;
  return new;
end $$;

create trigger coaches_guard
  before update on coaches
  for each row execute function coaches_guard_columns();

-- view ציבורי: רק approved, רק שדות מיתוג. coach-theme.js קורא מכאן (עם coaches.json כ-fallback).
create view coaches_public
  with (security_invoker = off) as
  select slug, display_name, tagline, brand_color, logo_path, logo_version, niche
  from coaches where status = 'approved';

grant select on coaches_public to anon, authenticated;

-- ============ coach_links (חיבור בהסכמה מפורשת) ============
create table coach_links (
  id            uuid primary key default gen_random_uuid(),
  trainee_id    uuid not null references profiles(id) on delete cascade,
  coach_id      uuid not null references coaches(id) on delete cascade,
  status        text not null default 'active' check (status in ('active','revoked')),
  -- אין 'pending': הוכרע בלי תור אישורים (חיבור מיידי כדי למנוע נשירה; המאמנת מסירה בדיעבד).
  trainee_display_name text not null check (char_length(trainee_display_name) between 1 and 40),
                -- המתאמנת קובעת במסך ההסכמה; כך profiles נשאר אטום לחלוטין למאמנת
  trainee_goal  text check (trainee_goal in ('cut','maintain','bulk')),
                -- נבחר בהסכמה ולא נגזר מ-prefs: שינוי מטרה באפליקציה לא דולף למאמנת
  share_weight  boolean not null default false,
                -- checkbox נפרד ורשות. false ⇒ coach_weight_trend מחזירה ריק.
  consent_text_version int not null,
  consent_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- קישור פעיל אחד בלבד למתאמנת; החלפת מאמנת = revoke + insert
create unique index one_active_link_per_trainee
  on coach_links(trainee_id) where status = 'active';
create index coach_links_coach_idx on coach_links(coach_id, status);

alter table coach_links enable row level security;

create policy coach_links_select on coach_links
  for select using (
    auth.uid() = trainee_id
    or exists (select 1 from coaches c where c.id = coach_links.coach_id and c.user_id = auth.uid())
  );

-- INSERT רק המתאמנת עצמה, ורק אל מאמנת מאושרת
create policy coach_links_insert_trainee on coach_links
  for insert with check (
    auth.uid() = trainee_id
    and exists (select 1 from coaches c where c.id = coach_id and c.status = 'approved')
  );

-- UPDATE: המתאמנת מנתקת את עצמה, *וגם* המאמנת מסירה מתאמנת (חריגה מודעת מהמסמך המחייב,
-- סעיף 2 — נדרשת ע"י הכרעת "בלי תור אישורים, אבל עם יכולת הסרה" מ-08/08/2026).
create policy coach_links_revoke on coach_links
  for update using (
    status = 'active' and (
      auth.uid() = trainee_id
      or exists (select 1 from coaches c where c.id = coach_links.coach_id and c.user_id = auth.uid())
    )
  ) with check (status = 'revoked');

-- trigger: המעבר היחיד המותר הוא active → revoked, ושאר השדות קפואים
create or replace function coach_links_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'active' or new.status <> 'revoked' then
    raise exception 'only active -> revoked is allowed';
  end if;
  if new.trainee_id is distinct from old.trainee_id
     or new.coach_id is distinct from old.coach_id
     or new.share_weight is distinct from old.share_weight
     or new.consent_at is distinct from old.consent_at then
    raise exception 'protected column';
  end if;
  new.revoked_at := now();
  return new;
end $$;

create trigger coach_links_transition
  before update on coach_links
  for each row execute function coach_links_guard();

-- ============ day_summaries (מה שהמאמנת רואה — התמדה בלבד) ============
create table day_summaries (
  trainee_id    uuid not null references profiles(id) on delete cascade,
  date          date not null,
  meals_planned smallint not null check (meals_planned between 1 and 10),
  meals_eaten   smallint not null check (meals_eaten between 0 and meals_planned),
  completed     boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (trainee_id, date)
  -- בכוונה אין כאן: קלוריות, יעד, שמות מאכלים, משקל. שום דבר תזונתי.
);
create index day_summaries_date_idx on day_summaries(date);

alter table day_summaries enable row level security;

-- הקריטית: המאמנת קוראת רק מתאמנות מקושרות active, ורק מ-consent_at והלאה.
-- ההסכמה לא פותחת עבר.
create policy day_summaries_select on day_summaries
  for select using (
    auth.uid() = trainee_id
    or exists (
      select 1 from coach_links l
      join coaches c on c.id = l.coach_id
      where c.user_id = auth.uid()
        and l.trainee_id = day_summaries.trainee_id
        and l.status = 'active'
        and day_summaries.date >= l.consent_at::date
    )
  );

create policy day_summaries_insert_own on day_summaries
  for insert with check (auth.uid() = trainee_id);
create policy day_summaries_update_own on day_summaries
  for update using (auth.uid() = trainee_id) with check (auth.uid() = trainee_id);

create trigger day_summaries_date_check
  before insert or update on day_summaries
  for each row execute function check_day_date();   -- ממחזר את הטריגר מ-001

-- ============================================================
-- RPCs
-- ============================================================

-- claim_coach: המאמנת תובעת את החשבון פעם אחת עם קוד ההזמנה שאלכס שלח.
create or replace function claim_coach(invite uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare rows_hit int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.coaches
     set user_id = auth.uid(), invite_code = gen_random_uuid()   -- הקוד נשרף מיד
   where invite_code = invite and user_id is null;
  get diagnostics rows_hit = row_count;
  if rows_hit = 0 then raise exception 'invalid or used invite'; end if;
end $$;

revoke execute on function claim_coach(uuid) from public, anon;
grant execute on function claim_coach(uuid) to authenticated;

-- rotate_invite: הלינק דלף (הודבק בקבוצה) — המאמנת מרעננת אותו בלחיצה.
create or replace function rotate_invite() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare fresh uuid;
begin
  update public.coaches set invite_code = gen_random_uuid()
   where user_id = auth.uid()
   returning invite_code into fresh;
  if fresh is null then raise exception 'not a coach'; end if;
  return fresh;
end $$;

revoke execute on function rotate_invite() from public, anon;
grant execute on function rotate_invite() to authenticated;

-- coach_by_invite: מסך ההסכמה צריך שם+מיתוג לפי הטוקן, לפני שנוצר קישור.
-- מחזיר רק שדות מיתוג ציבוריים (אותם שדות כמו coaches_public) + המזהה ליצירת הקישור.
create or replace function coach_by_invite(invite uuid)
returns table (id uuid, slug text, display_name text, tagline text,
               brand_color text, logo_path text, logo_version int)
language sql security definer set search_path = '' stable
as $$
  select c.id, c.slug, c.display_name, c.tagline, c.brand_color, c.logo_path, c.logo_version
  from public.coaches c
  where c.invite_code = invite and c.status = 'approved';
$$;

revoke execute on function coach_by_invite(uuid) from public;
grant execute on function coach_by_invite(uuid) to anon, authenticated;

-- ============================================================
-- coach_weight_trend — הפונקציה היחידה כאן שעוקפת RLS.
--
-- מאיפה מגיע המשקל: מ-weight_logs, שכבר קיימת ומאוכלסת ממעקב המשקל (מיגרציה 003).
-- לא נאסף שום נתון חדש.
--
-- 🔑 weight_logs נשארת ללא policy למאמנת. לכן הפונקציה חייבת SECURITY DEFINER,
--    ולכן *כל* ההרשאה נבדקת כאן במפורש: קישור active + share_weight + מ-consent_at והלאה.
--    היא עושה דבר אחד ויש לה שומר אחד, כדי שהיקף הביקורת יישאר זעיר.
--
-- מוחזר: delta בק"ג (הפרש בין הראשונה לאחרונה) + shape מנורמל 0-1 לציור הגרף.
-- ק"ג מוחלט לא יוצא מכאן בשום מסלול — צורה בלי סקאלה.
-- ============================================================
create or replace function coach_weight_trend(trainee uuid)
returns table (delta_kg numeric, shape numeric[])
language plpgsql security definer set search_path = '' stable
as $$
declare
  ok boolean;
  vals numeric[];
  lo numeric; hi numeric;
begin
  select exists (
    select 1 from public.coach_links l
    join public.coaches c on c.id = l.coach_id
    where c.user_id = auth.uid()
      and l.trainee_id = trainee
      and l.status = 'active'
      and l.share_weight = true
  ) into ok;
  if not ok then return; end if;   -- אין הרשאה ⇒ אפס שורות, בלי לרמוז למה

  select array_agg(w.weight_kg order by w.date)
    into vals
  from (
    select wl.weight_kg, wl.date
    from public.weight_logs wl
    join public.coach_links l on l.trainee_id = wl.trainee_id
    where wl.trainee_id = trainee
      and l.status = 'active'
      and wl.date >= l.consent_at::date     -- ההסכמה לא פותחת עבר, גם במשקל
    order by wl.date desc
    limit 6
  ) w;

  if vals is null or array_length(vals, 1) < 2 then return; end if;

  lo := (select min(v) from unnest(vals) v);
  hi := (select max(v) from unnest(vals) v);

  delta_kg := round(vals[array_length(vals,1)] - vals[1], 1);
  shape := (select array_agg(
             case when hi = lo then 0.5 else round((v - lo) / (hi - lo), 3) end
             order by ord)
           from unnest(vals) with ordinality as t(v, ord));
  return next;
end $$;

revoke execute on function coach_weight_trend(uuid) from public, anon;
grant execute on function coach_weight_trend(uuid) to authenticated;

-- ============================================================
-- coach_roster — SECURITY INVOKER: ה-RLS נאכף, ולכן מאמנת מקבלת רק את שלה.
-- מחשב התמדה/סטריק/שתיקה ב-SQL כדי שהלקוח לא ימשוך 14×N שורות.
-- ============================================================
create or replace function coach_roster()
returns table (
  trainee_id     uuid,
  display_name   text,
  goal           text,
  adherence      int,      -- % ב-14 יום
  streak         int,      -- רצף ימים עם ארוחה מסומנת, שנגמר היום/אתמול
  days_silent    int,      -- ימים מאז הסימון האחרון (999 = מעולם)
  needs_attention boolean, -- הדגל: שתקה 3 ימים ברצף (הכרעת 08/08)
  weight_delta   numeric,
  weight_shape   numeric[]
)
language sql security invoker stable
as $$
  with lnk as (
    select l.trainee_id, l.trainee_display_name, l.trainee_goal, l.consent_at
    from coach_links l
    join coaches c on c.id = l.coach_id
    where c.user_id = auth.uid() and l.status = 'active'
  ),
  s as (   -- ה-RLS על day_summaries כבר מגביל ל-consent_at והלאה; התנאי כאן הוא חגורה שנייה
    select k.trainee_id, d.date, d.meals_planned, d.meals_eaten
    from lnk k
    join day_summaries d on d.trainee_id = k.trainee_id and d.date >= k.consent_at::date
  ),
  agg as (
    select trainee_id,
      coalesce(round(100.0 * sum(meals_eaten) filter (where date > current_date - 14)
             / nullif(sum(meals_planned) filter (where date > current_date - 14), 0)), 0)::int as adherence,
      max(date) filter (where meals_eaten > 0) as last_active
    from s group by trainee_id
  ),
  islands as (   -- gaps-and-islands: ימי פעילות רצופים
    select trainee_id, date,
           date - (row_number() over (partition by trainee_id order by date))::int as grp
    from s where meals_eaten > 0
  ),
  cur as (
    select trainee_id, count(*)::int as streak
    from islands group by trainee_id, grp
    having max(date) >= current_date - 1   -- רק הרצף שעדיין חי
  )
  select
    k.trainee_id,
    k.trainee_display_name,
    k.trainee_goal,
    coalesce(a.adherence, 0),
    coalesce(c.streak, 0),
    coalesce((current_date - a.last_active)::int, 999),
    coalesce((current_date - a.last_active)::int, 999) >= 3,
    w.delta_kg,
    w.shape
  from lnk k
  left join agg a on a.trainee_id = k.trainee_id
  left join cur c on c.trainee_id = k.trainee_id
  left join lateral coach_weight_trend(k.trainee_id) w on true
  order by (coalesce((current_date - a.last_active)::int, 999) >= 3) desc,
           coalesce(a.adherence, 0) desc;
$$;

revoke execute on function coach_roster() from public, anon;
grant execute on function coach_roster() to authenticated;
