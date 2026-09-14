-- =========================================================================
-- schema_level_dex.sql — 랭킹에서 같은 반 친구의 완주 레벨·말랑이 도감 보기
--
-- Supabase SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
-- schema.sql, schema_class_league.sql 을 먼저 실행해 두어야 합니다.
--
-- 무엇인가
--   랭킹 화면에서 같은 반 친구를 누르면 그 친구의 완주 레벨(src/js/level.js)과
--   말랑이 도감(src/js/slime.js, 종류별 마릿수)이 보인다.
--   보이는 범위는 지금 랭킹이 이미 쓰는 동의와 똑같다 — 학급 대항전에 동의하고,
--   같은 반에 5명 이상 모인 경우에만. 새 동의를 만들지 않는다.
--
-- ⚠ 이 값은 검증되지 않는다
--   순공 시간(report_league)과 똑같은 신뢰 구조다. 클라이언트가 값을 만들어
--   보내면 서버는 "그럴듯한 범위인가"만 보고 "정말 그만큼 공부했는가/정말
--   그 말랑이를 키웠는가"는 확인할 수 없다 — 로그인도 계정도 없는 구조라서다.
--   그래서 표시값일 뿐이고, 이 값으로 무언가를 주고받는 기능(선물하기 등)은
--   만들지 않는다. 서버가 검증할 수 없는 값 위에 실제 재화 이동을 얹으면
--   장난삼아 조작한 값이 남의 화면에 그대로 뜬다.
--
-- 설계에서 정한 것
--   1. 새 테이블을 만들지 않는다. league_report 는 이미 device_id+week 로
--      한 사람의 그 주 상태를 담는 자리이니 여기 두 칸만 더한다.
--   2. 학급 대항전을 끄면 다음 동기화에서 빈 값으로 되돌아간다 — 닉네임과
--      같은 규칙이다(report_league 9-인자의 excluded.nickname 참고).
--   3. report_league 는 기존 이름에 인자만 더한 11-인자 오버로드로 만든다.
--      캐시된 옛 앱이 7·9-인자로 계속 불러도 그대로 동작해야 하기 때문이다.
-- =========================================================================

-- ───────────────────────────────────────────────────── 1. 열 추가
alter table public.league_report add column if not exists level_num integer not null default 0;
alter table public.league_report add column if not exists dex text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'level_num_range' and conrelid = 'public.league_report'::regclass
  ) then
    alter table public.league_report add constraint level_num_range check (level_num between 0 and 100000);
  end if;
  if not exists (
    -- "999,999,999,999,999,999,999,999,999" (9종 × 3자리 + 구분자 8개) = 35자.
    -- 넉넉히 40으로 둔다. 형식은 src/js/slime.js 의 dexSummary()/parseDexCsv() 가 정한다.
    select 1 from pg_constraint where conname = 'dex_len' and conrelid = 'public.league_report'::regclass
  ) then
    alter table public.league_report add constraint dex_len check (char_length(dex) <= 40);
  end if;
end $$;

-- ───────────────────────────────────────────────── 2. 11-인자 오버로드
-- 검증·상한은 전부 7-인자 본체(schema.sql)에 있다. 여기서는 그 위에
-- level_num·dex 두 칸만 더 채운다.
create or replace function public.report_league(
  p_device    uuid,
  p_week      date,
  p_school    text,
  p_minutes   integer,
  p_level     text,
  p_grade     text,
  p_klass     text,
  p_hidden    boolean,
  p_nickname  text,
  p_level_num integer,
  p_dex       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dex text := coalesce(p_dex, '');
  v_lv  integer := greatest(0, least(100000, coalesce(p_level_num, 0)));
begin
  -- 검증·상한은 9-인자 버전에 모두 들어 있으므로 그대로 태운다
  perform public.report_league(p_device, p_week, p_school, p_minutes,
                               p_level, p_grade, p_klass, p_hidden, p_nickname);
  if char_length(v_dex) > 40 then v_dex := ''; end if;   -- 형식이 이상하면 비워 둘 뿐, 통째로 막지 않는다

  update public.league_report
     set level_num = v_lv,
         dex       = v_dex
   where device_id = p_device and week = p_week;
end;
$$;

revoke all on function public.report_league(uuid, date, text, integer, text, text, text, boolean, text, integer, text) from public;
grant execute on function public.report_league(uuid, date, text, integer, text, text, text, boolean, text, integer, text) to anon, authenticated;

-- ───────────────────────────────────── 3. class_members 에 두 칸 더 얹기
-- 반환 컬럼이 늘어나므로 create or replace 로는 안 되고, 지운 뒤 다시 만들어야 한다.
-- 5명 미만이면 아무것도 안 주는 방어선(schema_class_league.sql)은 그대로 가져온다.
drop function if exists public.class_members(text, text, text, text, date, uuid);

create or replace function public.class_members(
  p_school text,
  p_level  text,
  p_grade  text,
  p_klass  text,
  p_week   date,
  p_device uuid default null
) returns table (
  tag text, minutes integer, updated_at timestamptz, is_me boolean, is_hidden boolean,
  level_num integer, dex text
)
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
      r.hidden as is_hidden,
      r.level_num,
      r.dex
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

-- 확인용
--   select device_id, week, level_num, dex from public.league_report
--    where level_num > 0 order by updated_at desc limit 5;
