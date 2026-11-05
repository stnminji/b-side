-- B-SIDE: 아티스트 감상 노트 (감상 노트의 '아티스트' 탭)
-- - 노래 감상(song_memos)과 같은 규칙: 아티스트당 1개, 1000자, 기본 비공개, 본인만 쓰기·고치기·지우기
-- - 아티스트는 Deezer 아티스트 번호로 구분 (중복 방지)
-- - 새 표만 추가 (기존 표·데이터는 건드리지 않음)

create table if not exists public.artist_memos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  artist_id  bigint not null check (artist_id > 0),
  name       text not null check (char_length(name) between 1 and 100),
  picture    text check (picture is null or (picture like 'https://%' and char_length(picture) <= 300)),
  memo       text not null check (char_length(memo) between 1 and 1000),
  is_public  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, artist_id)
);
create index if not exists artist_memos_user_idx on public.artist_memos (user_id, updated_at desc);
create index if not exists artist_memos_public_idx on public.artist_memos (artist_id, updated_at desc) where is_public;

alter table public.artist_memos enable row level security;
alter table public.artist_memos force row level security;
revoke all on public.artist_memos from anon, authenticated;
grant select on public.artist_memos to anon, authenticated;
grant insert (artist_id, name, picture, memo, is_public) on public.artist_memos to authenticated;
grant update (memo, is_public) on public.artist_memos to authenticated;   -- 아티스트·주인은 못 바꿈
grant delete on public.artist_memos to authenticated;

drop policy if exists "아티스트 감상 보기" on public.artist_memos;
create policy "아티스트 감상 보기" on public.artist_memos for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);
drop policy if exists "내 아티스트 감상 쓰기" on public.artist_memos;
create policy "내 아티스트 감상 쓰기" on public.artist_memos for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "내 아티스트 감상 고치기" on public.artist_memos;
create policy "내 아티스트 감상 고치기" on public.artist_memos for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "내 아티스트 감상 지우기" on public.artist_memos;
create policy "내 아티스트 감상 지우기" on public.artist_memos for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 수정 시각은 DB가 기록
create or replace function public.artist_memos_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists artist_memos_touch on public.artist_memos;
create trigger artist_memos_touch before update on public.artist_memos
  for each row execute function public.artist_memos_touch();
