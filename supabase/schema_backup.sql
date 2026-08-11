-- =========================================================================
-- schema_backup.sql — 복구 코드 백업 (기기를 바꿔도 기록이 따라오게)
--
-- Supabase SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
-- 다른 스키마 파일과 독립적입니다 — 리그를 쓰지 않아도 이것만 올릴 수 있습니다.
--
-- ⚠ 실행 전에 주소창의 /dashboard/project/<ref>/ 로 프로젝트를 확인하세요.
--   지금 앱이 보는 곳은 nflphvcjbpvjevcmmqoy 입니다. 이름만 보고 고르면 안 됩니다 —
--   빈 프로젝트에 스키마를 올려 두고 한참 헤맨 적이 있습니다.
--
-- 무엇인가
--   학습 기록은 브라우저 안에만 있다. 폰을 바꾸거나 브라우저 데이터를 지우면
--   몇 달치가 그대로 사라진다. 설정에 백업 파일 내려받기가 있지만,
--   그걸 스스로 누르는 학생은 거의 없다.
--   그래서 "복구 코드" 한 줄로 서버에 한 칸을 잡아 두고, 새 기기에서 그 코드만
--   넣으면 그대로 돌아오게 한다. 회원가입은 여전히 없다.
--
-- 설계에서 정한 것
--   1. 서버는 내용을 볼 수 없다.
--      앱이 복구 코드에서 키를 만들어(PBKDF2-SHA256 210k) AES-GCM 으로 암호화한
--      뒤에 올린다. 여기 저장되는 payload 는 암호문이다. 이름·학교·학년·반이
--      들어 있는 백업이라 평문으로 두면 안 된다.
--   2. 복구 코드 자체도 저장하지 않는다.
--      행을 찾는 열쇠(slot_id)는 코드의 SHA-256 해시 앞 32자다. 이 표를 통째로
--      가져가도 복구 코드를 되돌릴 수 없고, 따라서 복호화도 할 수 없다.
--   3. 코드를 잃어버리면 복구할 방법이 없다.
--      이메일도 비밀번호 찾기도 없는 구조라 그렇다. 앱 화면에 그렇게 적어 두었다.
--   4. 한 코드에 한 칸이다. 다시 올리면 덮어쓴다.
--      "언제 저장했는지"만 남기고 지난 판을 쌓아 두지 않는다 — 몇 판까지 남길지
--      정할 근거가 없고, 쌓아 두면 그만큼 오래 남는 개인정보가 된다.
--
-- 무차별 대입에 대해
--   복구 코드는 32글자 알파벳에서 12자를 뽑는다(32^12 ≈ 1.2e18).
--   조회는 slot_id(128비트)로만 되므로, 아무 값이나 넣어 남의 칸을 찾을 수 없다.
-- =========================================================================

-- ───────────────────────────────────────────────────────────── 1. 테이블
create table if not exists public.backup_slot (
  slot_id    text        primary key,
  payload    text        not null,             -- base64( iv(12B) || AES-GCM 암호문 )
  bytes      integer     not null default 0,   -- 암호화 전 크기 (화면 표시용)
  created_at timestamptz not null default now(),
  saved_at   timestamptz not null default now(),

  -- slot_id 는 앱이 만든 SHA-256 앞 32자다. 형식을 고정해 두면 잘못된 값이
  -- 테이블에 자리를 차지하는 일이 없다.
  constraint backup_slot_fmt check (slot_id ~ '^[0-9a-f]{32}$'),
  -- 2,000,000자 ≈ 원본 1.4MB. 지금 백업은 보통 100KB 아래다.
  constraint backup_payload_len check (char_length(payload) between 32 and 2000000),
  constraint backup_bytes_sane check (bytes between 0 and 4000000)
);

-- 오래된 칸 정리에만 쓴다
create index if not exists backup_slot_saved_idx on public.backup_slot (saved_at);

-- 정책을 하나도 만들지 않으면 anon 은 이 표에 직접 닿지 못한다.
-- 아래 함수 세 개만 통로로 남긴다.
alter table public.backup_slot enable row level security;
revoke all on public.backup_slot from anon, authenticated;

-- ─────────────────────────────────────────────────── 2. 올리기 (덮어쓰기)
create or replace function public.put_backup(
  p_slot    text,
  p_payload text,
  p_bytes   integer default 0
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot text := lower(btrim(coalesce(p_slot, '')));
  v_now  timestamptz := now();
begin
  if v_slot !~ '^[0-9a-f]{32}$' then
    raise exception '복구 코드 형식이 올바르지 않습니다.';
  end if;
  if p_payload is null or char_length(p_payload) < 32 then
    raise exception '백업 내용이 비어 있습니다.';
  end if;
  if char_length(p_payload) > 2000000 then
    raise exception '백업이 너무 큽니다. 오래된 기록을 정리한 뒤 다시 시도해 주세요.';
  end if;

  insert into public.backup_slot as b (slot_id, payload, bytes, saved_at)
  values (v_slot, p_payload, greatest(0, least(4000000, coalesce(p_bytes, 0))), v_now)
  on conflict (slot_id) do update
    set payload  = excluded.payload,
        bytes    = excluded.bytes,
        saved_at = v_now
    -- 같은 코드로 1초 안에 두 번 올리는 것은 실수이거나 자동 반복이다.
    where b.saved_at < v_now - interval '1 second';

  return v_now;
end;
$$;

revoke all on function public.put_backup(text, text, integer) from public;
grant execute on function public.put_backup(text, text, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────── 3. 내려받기
-- 코드를 아는 사람만 자기 칸을 가져간다. 없는 칸이면 빈 결과가 돌아온다.
create or replace function public.get_backup(p_slot text)
returns table (payload text, bytes integer, saved_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select b.payload, b.bytes, b.saved_at
    from public.backup_slot b
   where b.slot_id = lower(btrim(coalesce(p_slot, '')));
$$;

revoke all on function public.get_backup(text) from public;
grant execute on function public.get_backup(text) to anon, authenticated;

-- ─────────────────────────────────────────────────── 4. 지우기
-- 앱의 "복구 코드 끊기" 에서 부른다. 코드를 아는 사람만 자기 칸을 지운다.
create or replace function public.drop_backup(p_slot text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.backup_slot
   where slot_id = lower(btrim(coalesce(p_slot, '')));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.drop_backup(text) from public;
grant execute on function public.drop_backup(text) to anon, authenticated;

-- ─────────────────────────────────────────────────── 5. 오래된 칸 정리
-- 400일 동안 한 번도 갱신되지 않은 칸은 쓰지 않는 코드로 본다.
-- Supabase 대시보드의 Cron 에서 하루 한 번 부르면 된다:
--   select public.purge_old_backups();
create or replace function public.purge_old_backups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.backup_slot where saved_at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_backups() from public, anon, authenticated;

-- 확인용
--   select count(*) as slots, pg_size_pretty(sum(char_length(payload))::bigint) as stored
--     from public.backup_slot;
