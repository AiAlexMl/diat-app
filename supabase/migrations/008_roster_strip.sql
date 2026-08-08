-- ============================================================
-- 008_roster_strip.sql — רצועת 14 יום במקום אחוז התמדה
-- הרצה: Supabase Studio → SQL Editor (אחרי 007).
--
-- למה: "התמדה 40%" נקרא כציון נכשל, גם כשהמתאמנת אכלה הכל ורק שכחה ללחוץ.
-- וחשוב מזה, מספר בודד מוחק את התבנית: 40% מתאר גם "מסמנת חצי כל יום" וגם
-- "שבוע מושלם ואז נעלמה", ואלה שתי שיחות הפוכות. אנחנו מבטיחים למאמנת לזהות
-- התמדה ולדעת מתי להתערב, וזה דורש ציר זמן ולא ממוצע. (הוכרע 08/08/2026)
--
-- ⚠️ חתימת הפונקציה משתנה, ולכן drop לפני create.
-- ============================================================
drop function if exists coach_roster();

create function coach_roster()
returns table (
  trainee_id      uuid,
  display_name    text,
  goal            text,
  days            int[],    -- 14 ערכים, מהישן לחדש. null = לפני ההצטרפות, 0 = לא סימנה, N = מספר ארוחות
  active_days     int,      -- ימים שסומנו, מתוך החלון שבו היא בכלל מחוברת
  window_days     int,      -- כמה ימים היא איתנו (עד 14). המכנה האמיתי
  last_eaten      int,      -- ביום האחרון שסימנה
  last_planned    int,
  streak          int,
  days_silent     int,      -- 999 = מעולם לא סימנה
  needs_attention boolean,
  weight_delta    numeric,
  weight_shape    numeric[]
)
language sql security invoker stable
as $$
  with lnk as (
    select l.trainee_id, l.trainee_display_name, l.trainee_goal, l.consent_at
    from coach_links l
    join coaches c on c.id = l.coach_id
    where c.user_id = auth.uid() and l.status = 'active'
  ),
  -- שורה לכל מתאמנת × כל אחד מ-14 הימים. ימים שלפני ההסכמה נשארים null
  -- כדי שהם ייראו אחרת ולא ייספרו: מתאמנת שהצטרפה אתמול אינה "12 ימים שקטה".
  grid as (
    select k.trainee_id, g.d::date as date,
           case when g.d::date < k.consent_at::date then null
                else coalesce(s.meals_eaten, 0) end as eaten
    from lnk k
    cross join generate_series(current_date - 13, current_date, interval '1 day') g(d)
    left join day_summaries s on s.trainee_id = k.trainee_id and s.date = g.d::date
  ),
  strip as (
    select trainee_id,
           array_agg(eaten order by date) as days,
           count(*) filter (where eaten > 0)::int as active_days,
           count(*) filter (where eaten is not null)::int as window_days,
           max(date) filter (where eaten > 0) as last_active
    from grid group by trainee_id
  ),
  -- היחס ביום האחרון שבו סימנה משהו (לא ממוצע — צילום של הפעם האחרונה)
  lastday as (
    select distinct on (s.trainee_id) s.trainee_id, s.meals_eaten, s.meals_planned
    from day_summaries s
    join lnk k on k.trainee_id = s.trainee_id and s.date >= k.consent_at::date
    where s.meals_eaten > 0
    order by s.trainee_id, s.date desc
  ),
  islands as (
    select k.trainee_id, d.date,
           d.date - (row_number() over (partition by k.trainee_id order by d.date))::int as grp
    from lnk k
    join day_summaries d on d.trainee_id = k.trainee_id
     and d.date >= k.consent_at::date and d.meals_eaten > 0
  ),
  cur as (
    select trainee_id, count(*)::int as streak
    from islands group by trainee_id, grp
    having max(date) >= current_date - 1
  )
  select
    k.trainee_id,
    k.trainee_display_name,
    k.trainee_goal,
    st.days,
    coalesce(st.active_days, 0),
    coalesce(st.window_days, 0),
    ld.meals_eaten::int,
    ld.meals_planned::int,
    coalesce(c.streak, 0),
    coalesce((current_date - st.last_active)::int, 999),
    -- תקופת חסד של 3 ימים מההסכמה (007) נשמרת
    coalesce((current_date - st.last_active)::int, 999) >= 3
      and k.consent_at::date <= current_date - 3,
    w.delta_kg,
    w.shape
  from lnk k
  left join strip st on st.trainee_id = k.trainee_id
  left join lastday ld on ld.trainee_id = k.trainee_id
  left join cur c on c.trainee_id = k.trainee_id
  left join lateral coach_weight_trend(k.trainee_id) w on true
  order by
    (coalesce((current_date - st.last_active)::int, 999) >= 3
      and k.consent_at::date <= current_date - 3) desc,
    coalesce((current_date - st.last_active)::int, 999) desc;
$$;

revoke execute on function coach_roster() from public, anon;
grant execute on function coach_roster() to authenticated;
