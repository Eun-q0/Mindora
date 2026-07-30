-- =========================================================================
-- Mindora — 관리자용 개별 학생 추적 (추가 스키마)
--
-- schema.sql (학교 리그, 학교 단위 합계) 을 이미 실행했다는 전제로,
-- 이 파일을 [SQL Editor] 에 추가로 실행하세요. 순서: schema.sql → 이 파일.
--
-- schema.sql 과의 결정적 차이
--   schema.sql 의 school_week 뷰는 "학교 합계" 만 공개한다. 누가 몇 분 했는지는
--   원리상 알 수 없다 — 그게 그 설계의 핵심이었다.
--   이 파일은 그 반대다. 관리자가 "지민 · 대현중학교 · 3시간 20분" 처럼
--   개인을 식별해서 본다. 그래서 다음 두 가지가 필수로 따라온다.
--     1. 학생 데이터는 익명 키로 읽을 수 없다. 로그인한 관리자만 읽는다.
--     2. 학생이 이 기능에 동의했을 때만 데이터가 올라온다 (앱의 별도 옵트인).
--
-- 신뢰 모델: 이 스키마는 "관리자가 한 명(또는 소수)이고, 그 관리자는
-- 전체 학생 데이터를 볼 자격이 있다" 는 단순한 전제를 쓴다. 여러 학교를
-- 서로 못 보게 나누는 다중 관리자 구조가 아니다.
-- =========================================================================

-- ─────────────────────────────────────────────────────────── 원본 테이블
create table if not exists public.student_report (
  device_id  uuid        not null,
  week       date        not null,
  nickname   text        not null,
  school     text        not null,
  minutes    integer     not null default 0,
  updated_at timestamptz not null default now(),

  primary key (device_id, week),

  constraint s_minutes_range check (minutes >= 0 and minutes <= 2100),
  constraint s_school_len    check (char_length(school)   between 1 and 40),
  constraint s_nick_len      check (char_length(nickname) between 1 and 24)
);

create index if not exists student_report_week_school_idx
  on public.student_report (week, school);

-- ────────────────────────────────────────────────── 행 수준 보안 (RLS)
alter table public.student_report enable row level security;

-- anon 은 이 테이블에 직접 접근할 수 없다. 유일한 통로는 아래 report_student().
revoke all on public.student_report from anon;

-- ──────────────────────────────────────────────────────── 관리자 명단
-- 여기 등록된 Supabase Auth 사용자만 학생 개별 기록을 읽을 수 있다.
-- anon/authenticated 어느 쪽에도 권한을 주지 않는다 — SQL Editor(소유자)로만 관리한다.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- ────────────────────────────────────────────── 로그인한 관리자만 읽기
-- (create policy 에는 if not exists 가 없다. 다시 실행해도 되도록 먼저 지운다)
drop policy if exists "admins can read student_report" on public.student_report;
create policy "admins can read student_report"
  on public.student_report
  for select
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

grant select on public.student_report to authenticated;

-- ────────────────────────────────────────────────── 유일한 쓰기 통로
-- 학생 쪽은 로그인이 없다(로그인은 관리자 전용). 그래서 여기도 검증 함수 하나로만 쓴다.
create or replace function public.report_student(
  p_device   uuid,
  p_week     date,
  p_nickname text,
  p_school   text,
  p_minutes  integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school   text := btrim(p_school);
  v_nickname text := btrim(p_nickname);
begin
  if p_device is null or v_school = '' or v_nickname = '' then return; end if;
  if char_length(v_school) > 40 or char_length(v_nickname) > 24 then return; end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 2100 then return; end if;
  if p_week < current_date - interval '35 days' or p_week > current_date + interval '7 days' then
    return;
  end if;

  insert into public.student_report as r (device_id, week, nickname, school, minutes, updated_at)
  values (p_device, p_week, v_nickname, v_school, p_minutes, now())
  on conflict (device_id, week) do update
    set
      minutes    = greatest(r.minutes, excluded.minutes),  -- 되감기 방지
      nickname   = excluded.nickname,                       -- 닉네임 변경은 반영
      school     = excluded.school,
      updated_at = now();
end;
$$;

revoke all on function public.report_student(uuid, date, text, text, integer) from public;
grant execute on function public.report_student(uuid, date, text, text, integer) to anon, authenticated;

-- ───────────────────────────────────────────────────────────── 정리
create or replace function public.purge_old_student_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.student_report where week < current_date - interval '60 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_student_reports() from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- 관리자 계정 등록 — 아래 두 단계를 순서대로 하세요
-- ═════════════════════════════════════════════════════════════════════
--
-- ① Supabase 대시보드 → Authentication → Users → Add user
--    이메일과 비밀번호를 직접 정해서 계정을 만드세요.
--    (이 계정은 학생용이 아니라 은q님 전용 "관리자 로그인" 계정입니다)
--
-- ② 아래 문장의 이메일을 방금 만든 계정으로 바꿔서 실행하세요.
--    이걸 실행해야 그 계정이 실제로 학생 데이터를 볼 수 있습니다.

-- insert into public.admins (user_id)
-- select id from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL';
