-- =========================================================================
-- schema_class_league.sql — 반 대항 리그 공개 + 관리자 기록 삭제
--
-- Supabase SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
-- schema.sql, schema_admin.sql 을 먼저 실행해 두어야 합니다.
--
-- 규모 가정: 학교 10곳 × 넉넉히 250명 = 주당 2,500행.
-- 반으로 접으면 학교당 25반 안팎이라 많아야 250행이다. 집계는 뷰가 서버에서
-- 하고 클라이언트는 접힌 결과만 받으므로, 이 규모에서는 인덱스 하나로 충분하다.
-- =========================================================================

-- ───────────────────────────────────── 1. 반 순위를 학생 화면에 공개
-- class_week 는 schema.sql 에서 이미 만들어져 있고, 5명 미만인 반은
-- 애초에 뷰에서 빠진다. 학교+학년+반은 30명 남짓으로 좁혀지는 값이라
-- 인원이 적으면 사실상 특정 개인의 공부 시간이 되기 때문이다.
-- 그 방어선을 그대로 둔 채 읽기만 연다.
grant select on public.class_week to anon, authenticated;

-- ───────────────────────────────── 2. 아직 5명이 안 모인 반의 "참여 인원"
-- 순위표에 못 올라간 반이 그냥 사라지면 "우리 반은 왜 없냐" 로 끝난다.
-- 그렇다고 합계를 보여 주면 2명짜리 반에서 내 시간을 빼는 것만으로
-- 나머지 한 명의 공부 시간이 그대로 드러난다.
-- 그래서 인원 수만 내보낸다 — 몇 명 더 모으면 되는지 알리는 데는 충분하다.
create or replace view public.class_week_pending as
  select
    school, level, grade, klass, week,
    count(*)::int as members
  from public.league_report
  where klass is not null and btrim(klass) <> ''
    and grade is not null and btrim(grade) <> ''
  group by school, level, grade, klass, week
  having count(*) < 5;

grant select on public.class_week_pending to anon, authenticated;

-- ───────────────────────────────── 3. 관리자가 잘못된 기록을 지울 수 있게
-- 거짓 정보나 오류로 올라온 기록을 운영자가 정리할 수 있어야 한다.
-- RLS 정책 대신 함수로 두는 이유: 리그와 학생 목록 두 테이블을 한 번에
-- 지워야 하고(한쪽만 지우면 다른 화면에 계속 남는다), 관리자 확인을
-- 한 곳에서만 하면 되기 때문이다.
--
-- p_week 를 비우면 그 기기의 모든 주차를 지운다 (반복 악용 기기 정리용).
create or replace function public.admin_delete_device(
  p_device uuid,
  p_week   date default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_n     integer;
begin
  -- security definer 함수라도 auth.uid() 는 요청자의 것이 그대로 들어온다
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception '관리자만 삭제할 수 있습니다.';
  end if;
  if p_device is null then return 0; end if;

  if p_week is null then
    delete from public.league_report  where device_id = p_device;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
    delete from public.student_report where device_id = p_device;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  else
    delete from public.league_report  where device_id = p_device and week = p_week;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
    delete from public.student_report where device_id = p_device and week = p_week;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end if;

  return v_total;
end;
$$;

revoke all on function public.admin_delete_device(uuid, date) from public, anon;
grant execute on function public.admin_delete_device(uuid, date) to authenticated;

-- ───────────────────────── 4. 같은 반이면 자동으로 랭킹에 들어가게
-- 공유 코드를 주고받는 방식은 번거로워서 아무도 안 쓴다. 같은 학교·학년·반이면
-- 그냥 같은 판에 놓되, 서로에게는 익명으로만 보이게 한다.
--
-- 이름 대신 주차마다 바뀌는 짧은 태그를 쓴다. 기기 번호를 그대로 내보내면
-- 주가 바뀌어도 같은 사람을 계속 따라다닐 수 있어서, 주차를 섞어 해시한다.

alter table public.league_report add column if not exists hidden boolean not null default false;

-- 순위표에 보일 이름. 사용자가 프로필에 적은 닉네임을 그대로 쓴다.
-- 앱은 입력 단계에서 실명을 권하지 않는다고 안내한다 — 같은 반 친구에게
-- 그대로 보이는 값이라, 무엇이 보이는지 알고 정하게 하려는 것이다.
alter table public.league_report add column if not exists nickname text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nickname_len' and conrelid = 'public.league_report'::regclass
  ) then
    alter table public.league_report add constraint nickname_len check (
      nickname is null or char_length(nickname) <= 24
    );
  end if;
end $$;

-- 9-인자 오버로드. 앞의 버전들은 그대로 살아 있다(캐시된 옛 앱이 계속 동작해야 한다).
create or replace function public.report_league(
  p_device   uuid,
  p_week     date,
  p_school   text,
  p_minutes  integer,
  p_level    text,
  p_grade    text,
  p_klass    text,
  p_hidden   boolean,
  p_nickname text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := nullif(btrim(coalesce(p_nickname, '')), '');
begin
  -- 검증·상한은 7-인자 버전에 모두 들어 있으므로 그대로 태운다
  perform public.report_league(p_device, p_week, p_school, p_minutes, p_level, p_grade, p_klass);
  if v_nick is not null and char_length(v_nick) > 24 then
    v_nick := left(v_nick, 24);
  end if;
  update public.league_report
     set hidden   = coalesce(p_hidden, false),
         nickname = v_nick
   where device_id = p_device and week = p_week;
end;
$$;

revoke all on function public.report_league(uuid, date, text, integer, text, text, text, boolean, text) from public;
grant execute on function public.report_league(uuid, date, text, integer, text, text, text, boolean, text) to anon, authenticated;

-- 같은 반 사람들을 닉네임과 함께 돌려준다.
-- 5명이 안 되는 반은 아무것도 내보내지 않는다 — 인원이 적으면 순위표가
-- 사실상 특정 개인의 공부 시간을 가리키게 되기 때문이다.
-- 닉네임이 없는 옛 행은 예전처럼 짧은 태그로 대신한다.
create or replace function public.class_members(
  p_school text,
  p_level  text,
  p_grade  text,
  p_klass  text,
  p_week   date,
  p_device uuid default null
) returns table (tag text, minutes integer, updated_at timestamptz, is_me boolean, is_hidden boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.league_report r
   where r.week = p_week
     and btrim(r.school) = btrim(p_school)
     and btrim(coalesce(r.level, '')) = btrim(coalesce(p_level, ''))
     and btrim(coalesce(r.grade, '')) = btrim(coalesce(p_grade, ''))
     and btrim(coalesce(r.klass, '')) = btrim(coalesce(p_klass, ''));

  if v_n < 5 then return; end if;

  return query
    select
      coalesce(
        nullif(btrim(coalesce(r.nickname, '')), ''),
        upper(left(md5(r.device_id::text || r.week::text), 4))
      ) as tag,
      r.minutes,
      r.updated_at,
      (p_device is not null and r.device_id = p_device) as is_me,
      r.hidden as is_hidden
    from public.league_report r
   where r.week = p_week
     and btrim(r.school) = btrim(p_school)
     and btrim(coalesce(r.level, '')) = btrim(coalesce(p_level, ''))
     and btrim(coalesce(r.grade, '')) = btrim(coalesce(p_grade, ''))
     and btrim(coalesce(r.klass, '')) = btrim(coalesce(p_klass, ''))
     -- 숨긴 사람은 남에게 안 보인다. 본인에게는 보인다(숨김 상태로 표시된다).
     and (r.hidden = false or (p_device is not null and r.device_id = p_device))
   order by r.minutes desc;
end;
$$;

revoke all on function public.class_members(text, text, text, text, date, uuid) from public;
grant execute on function public.class_members(text, text, text, text, date, uuid) to anon, authenticated;

-- 확인용 — 관리자로 로그인한 상태에서만 행이 보입니다.
--   select * from public.class_week
--   where week = (date_trunc('week', (now() at time zone 'Asia/Seoul')::date))::date
--   order by total_min desc;
