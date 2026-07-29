-- 연결 확인 과정에서 넣은 시험용 행을 지웁니다.
-- Supabase [SQL Editor] 에 붙여 넣고 Run 하세요. 한 번만 실행하면 됩니다.

delete from public.league_report
where school in ('연결테스트', '합산테스트', '상한초과', '해킹학교', '테스트중학교');

-- 남은 내용 확인 — 실제 학교만 있어야 합니다
select school, sum(minutes) as total_min, count(*) as members
from public.league_report
group by school
order by total_min desc;
