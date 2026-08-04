-- =========================================================================
-- schema_admin_league.sql — 관리자가 "리그 시간을 올린 사람" 을 개별로 보게 한다
--
-- Supabase SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- ⚠ 여기서 보이는 것은 "익명 참가자" 입니다. 이름은 나오지 않습니다.
--    league_report 에는 닉네임 컬럼이 아예 없기 때문입니다.
--    학생들에게 "학교명과 학습 시간만 전송되고 이름은 전송되지 않는다" 고
--    안내하고 동의를 받았으므로, 그 약속을 지키려면 이대로 두어야 합니다.
--
--    이름까지 보려면 학생이 설정에서 [관리자에게 내 기록 보이기] 를 켜야 하고,
--    그 경우는 student_report 로 따로 들어와 이미 관리자 화면에 뜹니다.
--
-- 그래서 관리자 화면은 두 목록을 나란히 보여 줍니다.
--   1. 이름이 있는 목록  — student_report  (스스로 이름 공개에 동의한 학생)
--   2. 익명 참가자 목록  — league_report   (리그에만 참가한 학생)
-- =========================================================================

-- admins 테이블은 schema_admin.sql 에서 이미 만들어져 있어야 합니다.
-- (없다면 schema_admin.sql 을 먼저 실행하세요)

-- ───────────────────────────────────── 로그인한 관리자만 개별 행 읽기
-- anon 에게는 여전히 아무 권한도 주지 않습니다. 통로는 관리자 로그인 하나뿐입니다.
drop policy if exists "admins can read league_report" on public.league_report;
create policy "admins can read league_report"
  on public.league_report
  for select
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

grant select on public.league_report to authenticated;

-- 확인용 — 관리자 계정으로 로그인한 상태에서 실행하면 행이 보이고,
-- 그렇지 않으면 0행이 나와야 정상입니다.
--   select school, minutes, updated_at from public.league_report
--   where week = date_trunc('week', (now() at time zone 'Asia/Seoul')::date)::date;
