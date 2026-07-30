-- =========================================================================
-- Mindora — 학교 리그 백엔드 스키마 (Supabase / Postgres)
--
-- Supabase 대시보드의 [SQL Editor] 에 이 파일 전체를 붙여 넣고 실행하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 설계 원칙
--   1. 개인을 식별할 수 있는 값은 저장하지 않는다.
--      이름·학년·반·과목·뇌 컨디션 점수는 서버로 오지 않는다.
--      올라오는 것은 (무작위 기기 ID, 학교명, 주차, 분) 네 가지뿐이다.
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
