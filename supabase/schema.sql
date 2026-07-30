-- =========================================================================
-- Mindora — 학교 리그 백엔드 스키마 (Supabase / Postgres)
--
-- Supabase 대시보드의 [SQL Editor] 에 이 파일 전체를 붙여 넣고 실행하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 설계 원칙
--   1. 개인을 식별할 수 있는 값은 저장하지 않는다.
--      이름·과목·뇌 컨디션 점수는 어떤 경우에도 서버로 오지 않는다.
--      기본값으로 올라오는 것은 (무작위 기기 ID, 학교명, 주차, 분) 네 가지뿐이다.
--      학년·반은 "학급 대항전" 에 따로 동의한 사람만 함께 올린다.
--      학교 리그에만 동의한 사람의 학년·반은 올라오지 않는다 — 동의 시점의
--      약속이 "학년·반은 전송하지 않는다" 였으므로 소급해서 깨지 않는다.
--   2. 기기 ID 는 사람이 아니라 "중복 집계를 막기 위한 임의의 번호" 다.
--      앱에서 언제든 새로 발급할 수 있고, 그러면 이전 기록과 연결이 끊긴다.
--   3. 개별 행은 아무도 읽을 수 없다. 밖으로 나가는 것은 학교 단위 합계뿐이다.
--   4. 익명 키는 공개된다는 전제로 설계한다. 그래서 테이블에 직접 쓰지 못하게 막고,
--      검증을 거치는 함수 하나만 쓰기 통로로 남긴다.
-- =========================================================================

-- ─────────────────────────────────────────────────────────── 원본 테이블
create table if not exists public.league_report (
  device_id  uuid        not null,
  week       date        not null,
  school     text        not null,
  minutes    integer     not null default 0,
  updated_at timestamptz not null default now(),

  primary key (device_id, week),

  -- 한 사람이 한 주에 올릴 수 있는 상한: 하루 300분 × 7일
  constraint minutes_range check (minutes >= 0 and minutes <= 2100),
  constraint school_len    check (char_length(school) between 1 and 40)
);

-- 주차별 집계를 자주 읽으므로 인덱스를 둔다
create index if not exists league_report_week_school_idx
  on public.league_report (week, school);

-- ────────────────────────────────────────────────── 행 수준 보안 (RLS)
-- 정책을 하나도 만들지 않으면 anon 은 이 테이블을 읽지도 쓰지도 못한다.
-- 개별 기록이 밖으로 새지 않게 하려는 것이므로 이대로 둔다.
alter table public.league_report enable row level security;

revoke all on public.league_report from anon, authenticated;

-- ──────────────────────────────────────────────────────── 집계 뷰
-- security_invoker 를 켜지 않았으므로 이 뷰는 소유자 권한으로 동작한다.
-- 덕분에 RLS 로 잠긴 원본을 읽어 합계만 내보낼 수 있다.
create or replace view public.school_week as
  select
    school,
    week,
    sum(minutes)::int   as total_min,
    count(*)::int       as members,
    max(updated_at)     as updated_at
  from public.league_report
  group by school, week;

grant select on public.school_week to anon, authenticated;

-- ────────────────────────────────────────────────── 유일한 쓰기 통로
-- security definer 라서 RLS 를 우회한다. 그만큼 입력 검증을 여기서 다 한다.
create or replace function public.report_league(
  p_device  uuid,
  p_week    date,
  p_school  text,
  p_minutes integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school text := btrim(p_school);
begin
  -- 빈 학교명이나 말도 안 되는 값은 조용히 버린다
  if p_device is null or v_school = '' or char_length(v_school) > 40 then
    return;
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 2100 then
    return;
  end if;

  -- 너무 오래된 주나 미래의 주는 받지 않는다 (시계를 돌려 순위를 만드는 것을 막는다)
  if p_week < current_date - interval '35 days' or p_week > current_date + interval '7 days' then
    return;
  end if;

  insert into public.league_report as r (device_id, week, school, minutes, updated_at)
  values (p_device, p_week, v_school, p_minutes, now())
  on conflict (device_id, week) do update
    set
      -- 같은 주 안에서 순공 시간은 줄지 않는다. 되감기로 남을 끌어내릴 수 없게 한다.
      minutes    = greatest(r.minutes, excluded.minutes),
      -- 전학처럼 학교가 바뀌는 경우는 그대로 반영한다
      school     = excluded.school,
      updated_at = now();
end;
$$;

revoke all on function public.report_league(uuid, date, text, integer) from public;
grant execute on function public.report_league(uuid, date, text, integer) to anon, authenticated;

-- =========================================================================
-- 학급 대항전 (이벤트용)
--
-- 학교 리그는 학교 단위라 "1위 학급" 을 뽑을 수 없다. 그래서 학년·반을
-- 함께 받는 통로를 따로 연다. 다만 기존 참가자의 동의 내용이 "학년·반은
-- 전송하지 않는다" 였으므로, 아래 세 가지를 지킨다.
--
--   1. 컬럼은 nullable 이다. 기존 행과 학교 리그만 켠 사람은 계속 NULL 이다.
--   2. 기존 4-인자 report_league 를 그대로 남긴다. 서비스 워커에 캐시된
--      옛 앱이 계속 동작해야 한다. 새 통로는 7-인자 오버로드로 추가한다.
--   3. 학급 집계 뷰는 5명 미만인 학급을 아예 내보내지 않는다.
--      학교+학년+반은 30명 남짓으로 좁혀지는 값이라, 인원이 적으면
--      사실상 특정 개인의 공부 시간이 된다. 상품이 걸린 판에서 2명짜리
--      "학급" 이 1등을 먹는 것도 막아 준다.
-- =========================================================================

alter table public.league_report add column if not exists level text;
alter table public.league_report add column if not exists grade text;
alter table public.league_report add column if not exists klass text;

-- 길이 제한은 함수에서도 막지만, 테이블에도 한 겹 더 둔다
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'class_len' and conrelid = 'public.league_report'::regclass
  ) then
    alter table public.league_report add constraint class_len check (
      (level is null or char_length(level) <= 10) and
      (grade is null or char_length(grade) <= 8) and
      (klass is null or char_length(klass) <= 8)
    );
  end if;
end $$;

create index if not exists league_report_class_idx
  on public.league_report (week, school, level, grade, klass);

-- 학급 단위 합계. 학년·반을 올린 사람만 잡히고, 5명 이상인 학급만 나온다.
create or replace view public.class_week as
  select
    school, level, grade, klass, week,
    sum(minutes)::int as total_min,
    count(*)::int     as members,
    max(updated_at)   as updated_at
  from public.league_report
  where klass is not null and btrim(klass) <> ''
    and grade is not null and btrim(grade) <> ''
  group by school, level, grade, klass, week
  having count(*) >= 5;

-- 일부러 anon 에게 열지 않는다. 이벤트 집계는 운영자가 대시보드에서 본다.
-- 학생 화면에 학급 순위를 띄우고 싶어지면 그때 grant 를 다시 판단한다.
revoke all on public.class_week from anon, authenticated;

-- 7-인자 오버로드. 4-인자 버전은 그대로 살아 있다.
create or replace function public.report_league(
  p_device  uuid,
  p_week    date,
  p_school  text,
  p_minutes integer,
  p_level   text,
  p_grade   text,
  p_klass   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school text := btrim(p_school);
  v_level  text := btrim(coalesce(p_level, ''));
  v_grade  text := btrim(coalesce(p_grade, ''));
  v_klass  text := btrim(coalesce(p_klass, ''));
begin
  if p_device is null or v_school = '' or char_length(v_school) > 40 then
    return;
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 2100 then
    return;
  end if;
  if p_week < current_date - interval '35 days' or p_week > current_date + interval '7 days' then
    return;
  end if;

  -- 아는 값이 아니면 학급 정보만 버리고 학교 기록은 정상 처리한다
  if v_level not in ('초등학교', '중학교', '고등학교', '대학교', '기타') then v_level := ''; end if;
  if char_length(v_grade) > 8 then v_grade := ''; end if;
  if char_length(v_klass) > 8 then v_klass := ''; end if;

  insert into public.league_report as r (device_id, week, school, minutes, level, grade, klass, updated_at)
  values (p_device, p_week, v_school, p_minutes,
          nullif(v_level, ''), nullif(v_grade, ''), nullif(v_klass, ''), now())
  on conflict (device_id, week) do update
    set
      minutes    = greatest(r.minutes, excluded.minutes),
      school     = excluded.school,
      -- 반을 비우고 다시 보내면(동의 철회) 지워져야 한다. coalesce 로 붙들지 않는다.
      level      = excluded.level,
      grade      = excluded.grade,
      klass      = excluded.klass,
      updated_at = now();
end;
$$;

revoke all on function public.report_league(uuid, date, text, integer, text, text, text) from public;
grant execute on function public.report_league(uuid, date, text, integer, text, text, text) to anon, authenticated;

-- ── 이벤트 우승 학급 뽑기 (운영자가 SQL Editor 에서 실행)
--    기간을 이벤트 시작·종료 주차로 바꿔서 쓰세요.
--
--   select school, level, grade, klass,
--          sum(total_min) as month_min,
--          max(members)   as members,
--          round(sum(total_min)::numeric / 60, 1) as month_hours
--     from public.class_week
--    where week between date '2026-08-03' and date '2026-08-31'
--    group by school, level, grade, klass
--    order by month_min desc
--    limit 20;
--
--    ⚠ 이 순위를 그대로 시상하지 마세요. members 가 비정상적으로 많거나
--      1인당 시간이 상한(주 2100분)에 붙어 있는 학급은 조작을 의심해야 합니다.

-- ───────────────────────────────────────────────────────────── 정리
-- 지난 시즌 기록은 리그에 쓰이지 않는다. 오래된 행은 주기적으로 지운다.
-- Supabase [Database → Cron] 에서 주 1회 돌리면 된다:
--   select public.purge_old_reports();
create or replace function public.purge_old_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.league_report where week < current_date - interval '60 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_reports() from public, anon, authenticated;
