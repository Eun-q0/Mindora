-- 관리자 등록이 실제로 됐는지 확인합니다.
-- Supabase [SQL Editor] 에 붙여 넣고 Run 하세요.
--
-- 왜 필요한가:
--   insert ... select 는 조건에 맞는 계정이 하나도 없어도 "Success" 를 냅니다
--   (0줄 삽입도 성공입니다). 그래서 Success 만으로는 등록 여부를 알 수 없습니다.

select
  u.email,
  u.created_at                                   as 계정_생성,
  case when a.user_id is null
       then '❌ 관리자 아님 — 아래 ② 실행 필요'
       else '✅ 관리자로 등록됨'
  end                                            as 상태
from auth.users u
left join public.admins a on a.user_id = u.id
order by u.created_at;

-- ─────────────────────────────────────────────────────────────
-- 위 결과가 "행 0개(No rows)" 라면
--   → 계정 자체가 없는 것입니다.
--     Authentication → Users → Add user 로 계정을 먼저 만드세요.
--
-- 위 결과에 이메일은 보이는데 ❌ 라면
--   → 아래 ② 의 주석을 풀고 이메일을 바꿔 실행하세요.
-- ─────────────────────────────────────────────────────────────

-- ② 관리자로 등록 (이메일을 본인 것으로 바꾸세요)
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL'
-- on conflict (user_id) do nothing;
