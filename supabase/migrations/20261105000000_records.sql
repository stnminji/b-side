-- B-SIDE: 사용자별 '내 기록' (추천받은 결과 저장)
-- 보안 원칙
--   1) 행 단위 보안(RLS)을 켜서, 로그인한 사용자는 '자기 기록'만 보고/쓰고/지울 수 있다.
--   2) 로그인하지 않은 사용자(anon)는 이 표에 아예 접근할 수 없다.
--   3) user_id는 서버(DB)가 로그인 정보(auth.uid())로 채운다 → 남의 아이디로 저장하는 것 불가.

create table if not exists public.records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mode       text not null check (char_length(mode) <= 30),
  query      text not null check (char_length(query) <= 2000),
  summary    text check (char_length(summary) <= 500),
  tags       jsonb not null default '[]'::jsonb,
  bands      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- 너무 큰 데이터로 저장 공간을 채우는 것 방지
  constraint records_size check (pg_column_size(tags) + pg_column_size(bands) < 20000)
);

create index if not exists records_user_created_idx on public.records (user_id, created_at desc);

-- 행 단위 보안 켜기 (켜는 순간, 아래 정책에 맞는 행만 접근 가능)
alter table public.records enable row level security;
alter table public.records force row level security;

-- 로그인 안 한 사용자는 권한 자체를 없앤다
revoke all on public.records from anon;
grant select, insert, delete on public.records to authenticated;

drop policy if exists "내 기록 보기" on public.records;
create policy "내 기록 보기" on public.records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "내 기록 저장" on public.records;
create policy "내 기록 저장" on public.records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "내 기록 삭제" on public.records;
create policy "내 기록 삭제" on public.records
  for delete to authenticated
  using ((select auth.uid()) = user_id);
-- 수정(update) 정책은 만들지 않는다 → 저장된 기록은 수정 불가 (필요 없는 권한은 주지 않기)
