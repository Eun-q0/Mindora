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

-- ─────────────────────────────────────────── 기기가 언제부터 있었는지
-- 상품이 걸리면 "그 주에 새로 만들어진 기기 30개" 같은 흔적이 남는다.
-- 막을 수는 없어도, 정산 때 사람이 보고 걸러낼 근거는 된다.
create table if not exists public.device_seen (
  device_id  uuid primary key,
  first_seen date    not null,
  last_seen  date    not null,
  reports    integer not null default 0
);

alter table public.device_seen enable row level security;
revoke all on public.device_seen from anon, authenticated;

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
  -- 주차 키는 앱이 한국 시간 기준으로 만든다. 서버의 UTC 날짜로 재면
  -- 매일 아침 9시간 동안 하루씩 어긋난다.
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
  v_wkstart date;
  v_days   int;
  v_max    int;
  v_min    int := p_minutes;
begin
  if p_device is null or v_school = '' or char_length(v_school) > 40 then
    return;
  end if;
  if v_min is null or v_min < 0 then
    return;
  end if;
  if p_week < v_today - interval '35 days' or p_week > v_today + interval '7 days' then
    return;
  end if;

  /* 진행형 상한.
   * 지금까지는 월요일 아침에도 2100분(주 7일치)을 한 번에 올릴 수 있었다.
   * 실제로는 그 주에 지난 날 수 × 300분을 넘을 수 없다. 값을 버리지 않고
   * 깎는 이유는, 시계가 어긋난 정상 사용자의 기록까지 날리지 않기 위해서다.
   * 조작하는 쪽은 한 달 내내 매일 조금씩 올려야 하므로 비용이 크게 오른다. */
  v_wkstart := (v_today - ((extract(isodow from v_today)::int - 1) || ' days')::interval)::date;
  if p_week > v_wkstart then
    -- 아직 시작도 안 한 주. 시계를 앞당겨 미리 채워 두는 걸 막는다.
    -- (버리지 않고 0 으로 둔다. 그 주가 실제로 오면 다시 올라와 채워진다)
    v_days := 0;
  elsif p_week = v_wkstart then
    v_days := extract(isodow from v_today)::int;   -- 이번 주는 오늘까지만 인정
  else
    v_days := 7;                                    -- 지난 주는 온전히 인정
  end if;
  v_max := v_days * 300;
  if v_min > v_max then v_min := v_max; end if;

  -- 아는 값이 아니면 학급 정보만 버리고 학교 기록은 정상 처리한다
  if v_level not in ('초등학교', '중학교', '고등학교', '대학교', '기타') then v_level := ''; end if;
  if char_length(v_grade) > 8 then v_grade := ''; end if;
  if char_length(v_klass) > 8 then v_klass := ''; end if;

  /* 기기가 언제 처음 나타났고 몇 번 올렸는지 남긴다.
   * 진짜 앱은 한 주에 수십 번 동기화하지만, 스크립트로 만든 가짜 기기는
   * 보통 한두 번 쏘고 끝난다. 이벤트 정산 때 이 차이가 근거가 된다.
   * 새로 저장하는 개인정보는 없다 — device_id 는 이미 갖고 있는 값이다. */
  insert into public.device_seen as d (device_id, first_seen, last_seen, reports)
  values (p_device, v_today, v_today, 1)
  on conflict (device_id) do update
    set last_seen = v_today,
        reports   = d.reports + 1;

  insert into public.league_report as r (device_id, week, school, minutes, level, grade, klass, updated_at)
  values (p_device, p_week, v_school, v_min,
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

-- ────────────────────────────────── 옛 앱이 부르는 4-인자 버전 (호환용)
-- 서비스 워커에 캐시된 옛 앱은 아직 이 이름으로 부른다.
-- 검증을 여기에 한 벌 더 두면 두 통로의 규칙이 어긋나고, 공격자는 느슨한
-- 쪽만 골라 쓴다. 그래서 학급 정보를 비운 채 위 본체로 넘기기만 한다.
-- (위 함수가 반드시 먼저 만들어져 있어야 하므로 순서를 바꾸지 말 것)
--
-- 이 경로로 들어오면 그 기기의 학년·반은 지워진다. 학급 대항전에 동의한
-- 사람이 캐시된 옛 화면을 열어 두면 잠깐 빠졌다가, 새 앱이 다음 동기화에서
-- 다시 채운다. 덜 보내는 쪽으로 틀리는 것이라 이대로 둔다.
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
begin
  -- 명시적 캐스트를 붙여 어느 오버로드를 부르는지 모호해지지 않게 한다
  perform public.report_league(p_device, p_week, p_school, p_minutes,
                               null::text, null::text, null::text);
end;
$$;

revoke all on function public.report_league(uuid, date, text, integer) from public;
grant execute on function public.report_league(uuid, date, text, integer) to anon, authenticated;

-- =========================================================================
-- 이벤트 정산 — 막는 게 아니라 걸러내는 쪽으로 설계한다
--
-- 익명 키는 앱 안에 들어 있고 로그인이 없다. 그래서 누구나 REST 로 직접
-- report_league 를 부를 수 있고, 기기 번호는 얼마든지 새로 만들 수 있다.
-- 이건 구조상 "차단" 이 불가능하다. 로그인을 붙이지 않는 한 그렇다.
--
-- 그래서 세 겹으로 간다.
--   1. 비용을 올린다  — 진행형 상한(위 함수). 한 방에 못 채우고 매일 나눠야 한다.
--   2. 흔적을 남긴다  — device_seen. 급조한 기기는 first_seen 과 reports 로 드러난다.
--   3. 사람이 정한다  — event_class 로 신청한 학급만 후보에 올리고, 아래 감사
--                      뷰를 보고 최종 확정한다.
-- =========================================================================

-- 참가 신청한 학급만 상품 대상이 된다. 운영자가 신청서를 보고 직접 넣는다.
-- (연락처를 여기 두는 이유: 앱은 이름·연락처를 모으지 않으므로 우승해도
--  연락할 방법이 없다. 신청 단계에서 받은 값을 운영자가 보관한다.)
create table if not exists public.event_class (
  school   text not null,
  level    text not null,
  grade    text not null,
  klass    text not null,
  contact  text,
  note     text,
  added_at timestamptz not null default now(),
  primary key (school, level, grade, klass)
);

alter table public.event_class enable row level security;
revoke all on public.event_class from anon, authenticated;

-- 조작 의심 신호를 학급별로 모아 둔다. 운영자 전용.
create or replace view public.class_audit as
  select
    r.school, r.level, r.grade, r.klass, r.week,
    count(*)::int                                          as members,
    sum(r.minutes)::int                                    as total_min,
    round(avg(r.minutes))::int                             as avg_min,
    -- 주 상한(2100분)에 바짝 붙은 사람 수
    count(*) filter (where r.minutes >= 2000)::int          as near_cap,
    -- 그 주에 처음 생긴 기기 수. 학급 전체가 새 기기면 급조를 의심한다.
    count(*) filter (where d.first_seen >= r.week)::int     as new_devices,
    -- 올린 횟수가 극히 적은 기기 수. 진짜 앱은 한 주에 수십 번 동기화한다.
    count(*) filter (where coalesce(d.reports, 0) <= 2)::int as few_reports,
    max(r.updated_at)                                      as updated_at
  from public.league_report r
  left join public.device_seen d on d.device_id = r.device_id
  where r.klass is not null and btrim(r.klass) <> ''
    and r.grade is not null and btrim(r.grade) <> ''
  group by r.school, r.level, r.grade, r.klass, r.week
  having count(*) >= 5;

revoke all on public.class_audit from anon, authenticated;

-- ── 이벤트 우승 학급 뽑기 (운영자가 SQL Editor 에서 실행)
--    기간을 이벤트 시작·종료 주차로 바꿔서 쓰세요.
--    event_class 에 신청서를 먼저 넣어야 후보가 잡힙니다.
--
--   select a.school, a.level, a.grade, a.klass,
--          sum(a.total_min)                        as month_min,
--          round(sum(a.total_min)::numeric/60, 1)  as month_hours,
--          max(a.members)                          as members,
--          sum(a.near_cap)                         as near_cap,
--          sum(a.new_devices)                      as new_devices,
--          sum(a.few_reports)                      as few_reports,
--          e.contact
--     from public.class_audit a
--     join public.event_class e
--       on (e.school, e.level, e.grade, e.klass) = (a.school, a.level, a.grade, a.klass)
--    where a.week between date '2026-08-03' and date '2026-08-31'
--    group by a.school, a.level, a.grade, a.klass, e.contact
--    order by month_min desc
--    limit 20;
--
--    ⚠ 1등을 그대로 시상하지 마세요. 아래에 해당하면 조작을 의심합니다.
--      · new_devices 가 members 와 거의 같다  → 이벤트 맞춰 급조한 기기
--      · few_reports 가 많다                  → 앱을 안 쓰고 API 만 쏜 기기
--      · near_cap 이 많다                     → 전원이 매일 5시간 만점
--      정상적인 반은 기기 생성일이 흩어져 있고, reports 가 수십 회이며,
--      상한에 붙은 사람은 소수입니다.

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

  -- 기록이 하나도 안 남은 기기는 추적 정보도 같이 버린다.
  -- 조작 판별에 쓰려고 두는 값이지, 오래 갖고 있을 이유는 없다.
  delete from public.device_seen d
   where not exists (select 1 from public.league_report r where r.device_id = d.device_id);

  return n;
end;
$$;

revoke all on function public.purge_old_reports() from public, anon, authenticated;
