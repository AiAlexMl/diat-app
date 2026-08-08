-- ============================================================
-- 007_flag_grace.sql — מתאמנת חדשה לא נכנסת ישר כדגל אדום
-- הרצה: Supabase Studio → SQL Editor (אחרי 006).
--
-- נתפס בבדיקה ידנית 08/08/2026: מתאמנת שהתחברה לפני דקה סומנה מיד
-- "צריכים תשומת לב". הסיבה: כשאין עדיין שום day_summary, days_silent מקבל 999,
-- וזה חוצה את סף 3 הימים.
--
-- למה זה חשוב ולא קוסמטי: הדגל האדום אמור להיות הסיגנל שאומר למאמנת איפה
-- להתערב. אם הוא נדלק על כל מתאמנת חדשה, המאמנת לומדת להתעלם ממנו,
-- והוא מאבד ערך גם כשהוא צודק.
--
-- התיקון: תקופת חסד של 3 ימים מרגע ההסכמה. עד אז מוצג "טרם התחילה"
-- בלי אדום, והיא לא נספרת במונה.
-- ============================================================
create or replace function coach_roster()
returns table (
  trainee_id     uuid,
  display_name   text,
  goal           text,
  adherence      int,
  streak         int,
  days_silent    int,
  needs_attention boolean,
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
  s as (
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
  islands as (
    select trainee_id, date,
           date - (row_number() over (partition by trainee_id order by date))::int as grp
    from s where meals_eaten > 0
  ),
  cur as (
    select trainee_id, count(*)::int as streak
    from islands group by trainee_id, grp
    having max(date) >= current_date - 1
  ),
  calc as (
    select k.trainee_id, k.trainee_display_name, k.trainee_goal,
           coalesce(a.adherence, 0) as adherence,
           coalesce(c.streak, 0) as streak,
           coalesce((current_date - a.last_active)::int, 999) as days_silent,
           -- 🔑 תקופת החסד: לא מסמנים לפני שעברו 3 ימים מההסכמה
           coalesce((current_date - a.last_active)::int, 999) >= 3
             and k.consent_at::date <= current_date - 3 as needs_attention,
           w.delta_kg, w.shape
    from lnk k
    left join agg a on a.trainee_id = k.trainee_id
    left join cur c on c.trainee_id = k.trainee_id
    left join lateral coach_weight_trend(k.trainee_id) w on true
  )
  select trainee_id, trainee_display_name, trainee_goal, adherence, streak,
         days_silent, needs_attention, delta_kg, shape
  from calc
  order by needs_attention desc, adherence desc;
$$;

revoke execute on function coach_roster() from public, anon;
grant execute on function coach_roster() to authenticated;
