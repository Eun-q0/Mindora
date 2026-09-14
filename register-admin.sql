-- 관리자 등록 — 이메일을 고쳐 넣을 필요 없이 그대로 실행하면 됩니다.
--
-- 지금 auth.users 에 들어 있는 계정을 전부 관리자로 등록합니다.
-- 이 앱에는 가입 화면이 없고, 계정은 대시보드에서 직접 만든 것뿐이라
-- 지금 시점에서는 "내가 만든 계정" 과 같은 뜻입니다.
-- (이 문장은 지금 있는 계정만 등록합니다. 나중에 생기는 계정은 등록되지 않습니다.)

insert into public.admins (user_id, note)
select id, 'registered ' || now()::date
from auth.users
on conflict (user_id) do nothing;

-- 결과 확인 — ✅ 로 바뀌었는지 보세요
select
  u.email,
  case when a.user_id is null then '❌ 관리자 아님' else '✅ 관리자로 등록됨' end as 상태
from auth.users u
left join public.admins a on a.user_id = u.id
order by u.created_at;
