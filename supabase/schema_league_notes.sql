-- =========================================================================
-- schema_league_notes.sql — 우리 반 포스트잇 (짧게 살아 있는 쪽지)
--
-- Supabase SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
-- schema.sql, schema_class_league.sql 을 먼저 실행해 두어야 합니다.
--
-- 무엇인가
--   같은 학교·학년·반 사람들이 서로 보는 쪽지 벽이다. 화면 아무 데나 붙이고,
--   10~30분 사이에서 고른 시간이 지나면 사라진다. 대화처럼 쓰라고 만든 기능이라
--   기록을 남기는 것이 목적이 아니다 — 그래서 지난 쪽지를 다시 볼 방법을 두지 않는다.
--
-- 설계에서 정한 것
--   1. 오래 남기지 않는다. 최대 수명은 30분이고, 만료된 행은 다음 게시 때 지워진다.
--      "지워진 것처럼 보이지만 서버에는 남아 있는" 상태를 만들지 않기 위해서다.
--   2. 리그 기록과 섞지 않는다. 별도 테이블이라 리그를 지우거나 옮겨도 서로 영향이 없다.
--   3. 말을 거르는 일은 서버에서 하지 않는다. 욕설 목록은 앱(src/js/filter.js)
--      한 곳에만 둔다 — 같은 목록을 두 곳에 두면 규칙이 어긋나고, 쓰는 쪽은
--      느슨한 통로만 골라 쓰게 된다. 서버는 길이·개수·시간만 본다.
--      대신 앱은 화면에 그릴 때도 한 번 더 걸러, 다른 통로로 들어온 글을 가린다.
--   4. 누가 썼는지는 닉네임뿐이다. 기기 번호는 "내 쪽지인지" 를 가리고
--      본인만 지우거나 옮길 수 있게 하는 데만 쓰이고, 밖으로 나가지 않는다.
--
-- ⚠ 익명 키로 열리는 통로다. 학교·학년·반을 아는 사람이면 그 반의 쪽지를 읽을 수 있다.
--   (같은 반 순위표와 같은 조건이다.) 앱 화면에도 그렇게 적어 두었으니,
--   개인적인 이야기를 적는 곳으로 안내하지 말 것.
-- =========================================================================

-- ───────────────────────────────────────────────────────────── 1. 테이블
create table if not exists public.class_note (
  id         uuid        primary key default gen_random_uuid(),
  device_id  uuid        not null,
  school     text        not null,
  level      text        not null default '',
  grade      text        not null,
  klass      text        not null,
  nickname   text,
  body       text        not null,
  color      smallint    not null default 0,   -- 쪽지 색 (앱의 팔레트 번호)
  tilt       smallint    not null default 0,   -- 삐뚤게 붙은 각도 (-6 ~ 6도)
  x          smallint    not null default 50,  -- 붙인 자리 (화면 가로 %)
  y          smallint    not null default 40,  -- 붙인 자리 (화면 세로 %)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  constraint note_body_len check (char_length(body) between 1 and 100),
  constraint note_nick_len check (nickname is null or char_length(nickname) <= 24),
  constraint note_scope_len check (
    char_length(school) between 1 and 40 and
    char_length(grade)  between 1 and 8  and
    char_length(klass)  between 1 and 8  and
    char_length(level)  <= 10
  ),
  -- 수명은 10분 이상 30분 이하. 이 검사는 함수와 무관하게 테이블에서도 한 겹 더 막는다.
  constraint note_life check (
    expires_at > created_at and expires_at <= created_at + interval '31 minutes'
  ),
  constraint note_spot check (x between 0 and 100 and y between 0 and 100)
);

-- 한 반의 살아 있는 쪽지를 뽑는 것이 유일한 조회 패턴이다
create index if not exists class_note_scope_idx
  on public.class_note (school, level, grade, klass, expires_at);

-- 만료 정리와 기기별 제한에 쓴다
create index if not exists class_note_device_idx
  on public.class_note (device_id, created_at desc);

-- 정책을 하나도 만들지 않으면 anon 은 이 테이블에 직접 닿지 못한다.
-- 아래 함수 네 개만 통로로 남긴다.
alter table public.class_note enable row level security;
revoke all on public.class_note from anon, authenticated;

-- ─────────────────────────────────────────────────── 2. 쪽지 붙이기
-- 한 사람이 동시에 붙일 수 있는 쪽지는 5장, 연달아 붙이는 간격은 8초로 둔다.
-- 벽이 한 사람으로 도배되면 대화가 아니라 소음이 되기 때문이다.
create or replace function public.post_class_note(
  p_device  uuid,
  p_school  text,
  p_level   text,
  p_grade   text,
  p_klass   text,
  p_nick    text,
  p_body    text,
  p_minutes integer,
  p_color   integer default 0,
  p_tilt    integer default 0,
  p_x       integer default 50,
  p_y       integer default 40
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school text := btrim(coalesce(p_school, ''));
  v_level  text := btrim(coalesce(p_level, ''));
  v_grade  text := btrim(coalesce(p_grade, ''));
  v_klass  text := btrim(coalesce(p_klass, ''));
  v_nick   text := nullif(btrim(coalesce(p_nick, '')), '');
  v_body   text := btrim(coalesce(p_body, ''));
  v_min    integer := coalesce(p_minutes, 15);
  v_alive  integer;
  v_last   timestamptz;
  v_id     uuid;
begin
  if p_device is null then
    raise exception '기기 정보가 없습니다.';
  end if;
  if v_school = '' or v_grade = '' or v_klass = '' then
    raise exception '학교·학년·반이 있어야 쪽지를 붙일 수 있습니다.';
  end if;
  if v_body = '' then
    raise exception '내용이 비어 있습니다.';
  end if;
  if char_length(v_body) > 100 then v_body := left(v_body, 100); end if;
  if v_nick is not null and char_length(v_nick) > 24 then v_nick := left(v_nick, 24); end if;

  -- 고른 시간은 10~30분 사이로만 받는다. 벗어나면 버리지 않고 가까운 쪽으로 당긴다.
  if v_min < 10 then v_min := 10; end if;
  if v_min > 30 then v_min := 30; end if;

  -- 만료된 쪽지는 여기서 치운다. 따로 도는 청소 작업을 두지 않아도
  -- 누군가 쪽지를 붙일 때마다 테이블이 정리된다.
  delete from public.class_note where expires_at < now();

  select count(*), max(created_at) into v_alive, v_last
    from public.class_note
   where device_id = p_device;

  if v_last is not null and v_last > now() - interval '8 seconds' then
    raise exception '조금 천천히 붙여 주세요.';
  end if;
  if v_alive >= 5 then
    raise exception '한 번에 붙일 수 있는 쪽지는 5장까지입니다.';
  end if;

  insert into public.class_note
    (device_id, school, level, grade, klass, nickname, body, color, tilt, x, y, expires_at)
  values
    (p_device, v_school, v_level, v_grade, v_klass, v_nick, v_body,
     greatest(0, least(15, coalesce(p_color, 0))),
     greatest(-6, least(6, coalesce(p_tilt, 0))),
     greatest(0, least(100, coalesce(p_x, 50))),
     greatest(0, least(100, coalesce(p_y, 40))),
     now() + (v_min || ' minutes')::interval)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.post_class_note(uuid, text, text, text, text, text, text, integer, integer, integer, integer, integer) from public;
grant execute on function public.post_class_note(uuid, text, text, text, text, text, text, integer, integer, integer, integer, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────── 3. 쪽지 읽기
-- 아직 살아 있는 것만, 오래된 것부터 최대 40장.
-- (한 반에 40장이 넘게 붙는 일은 거의 없고, 넘으면 화면이 읽을 수 없게 된다)
create or replace function public.fetch_class_notes(
  p_school text,
  p_level  text,
  p_grade  text,
  p_klass  text,
  p_device uuid default null
) returns table (
  id uuid, nickname text, body text,
  color smallint, tilt smallint, x smallint, y smallint,
  created_at timestamptz, expires_at timestamptz, is_me boolean
)
language sql
security definer
set search_path = public
as $$
  select
    n.id, n.nickname, n.body, n.color, n.tilt, n.x, n.y,
    n.created_at, n.expires_at,
    (p_device is not null and n.device_id = p_device) as is_me
  from public.class_note n
  where n.expires_at > now()
    and btrim(n.school) = btrim(p_school)
    and btrim(coalesce(n.level, '')) = btrim(coalesce(p_level, ''))
    and btrim(coalesce(n.grade, '')) = btrim(coalesce(p_grade, ''))
    and btrim(coalesce(n.klass, '')) = btrim(coalesce(p_klass, ''))
  order by n.created_at asc
  limit 40;
$$;

revoke all on function public.fetch_class_notes(text, text, text, text, uuid) from public;
grant execute on function public.fetch_class_notes(text, text, text, text, uuid) to anon, authenticated;

-- ─────────────────────────────────────────────────── 4. 내 쪽지 옮기기
-- 붙인 뒤에 자리를 바꾸는 것은 본인만 할 수 있다.
create or replace function public.move_class_note(
  p_id     uuid,
  p_device uuid,
  p_x      integer,
  p_y      integer
) returns void
language sql
security definer
set search_path = public
as $$
  update public.class_note
     set x = greatest(0, least(100, coalesce(p_x, 50))),
         y = greatest(0, least(100, coalesce(p_y, 40)))
   where id = p_id and device_id = p_device and expires_at > now();
$$;

revoke all on function public.move_class_note(uuid, uuid, integer, integer) from public;
grant execute on function public.move_class_note(uuid, uuid, integer, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────── 5. 내 쪽지 떼기
-- 남의 쪽지는 지울 수 없다. 남의 화면에서 치우는 것(엑스 버튼)은 서버를 거치지 않고
-- 그 사람 기기에만 기록된다 — 한 사람이 눌렀다고 모두의 화면에서 사라지면 안 된다.
create or replace function public.remove_class_note(
  p_id     uuid,
  p_device uuid
) returns void
language sql
security definer
set search_path = public
as $$
  delete from public.class_note where id = p_id and device_id = p_device;
$$;

revoke all on function public.remove_class_note(uuid, uuid) from public;
grant execute on function public.remove_class_note(uuid, uuid) to anon, authenticated;

-- ─────────────────────────────────────────────────── 6. 관리자 정리
-- 문제가 되는 쪽지를 운영자가 지울 수 있어야 한다. 쪽지는 길어야 30분이면
-- 스스로 사라지므로, 평소에는 쓸 일이 없고 신고가 들어왔을 때만 쓴다.
--   select public.admin_clear_notes('한빛고등학교', '고등학교', '2', '3');
--   select public.admin_clear_notes();   -- 전체 비우기
create or replace function public.admin_clear_notes(
  p_school text default null,
  p_level  text default null,
  p_grade  text default null,
  p_klass  text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception '관리자만 지울 수 있습니다.';
  end if;

  delete from public.class_note
   where (p_school is null or btrim(school) = btrim(p_school))
     and (p_level  is null or btrim(coalesce(level, '')) = btrim(p_level))
     and (p_grade  is null or btrim(grade) = btrim(p_grade))
     and (p_klass  is null or btrim(klass) = btrim(p_klass));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.admin_clear_notes(text, text, text, text) from public, anon;
grant execute on function public.admin_clear_notes(text, text, text, text) to authenticated;

-- 확인용 — 지금 살아 있는 쪽지 수
--   select count(*) from public.class_note where expires_at > now();
