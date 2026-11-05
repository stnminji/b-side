-- B-SIDE: 노래별 '내 메모'
-- - 노래는 Deezer 곡 번호(track_id)로 구분한다 (이름 표기가 달라도 같은 곡으로 인식)
-- - 사용자당 노래 하나에 메모 하나 (다시 쓰면 덮어쓰기)
-- - 기본 비공개. 나중에 소셜 기능에서 '공개' 메모만 다른 사람에게 보이게 한다 (records와 같은 구조)

create table if not exists public.song_memos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  track_id   bigint not null check (track_id > 0),
  artist     text not null check (char_length(artist) between 1 and 100),
  title      text not null check (char_length(title) between 1 and 200),
  cover      text check (cover is null or (cover like 'https://%' and char_length(cover) <= 300)),
  memo       text not null check (char_length(memo) between 1 and 1000),
  is_public  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, track_id)
);

create index if not exists song_memos_user_updated_idx on public.song_memos (user_id, updated_at desc);
create index if not exists song_memos_public_idx on public.song_memos (track_id, updated_at desc) where is_public;

alter table public.song_memos enable row level security;
alter table public.song_memos force row level security;

revoke all on public.song_memos from anon, authenticated;
grant select on public.song_memos to anon, authenticated;
grant insert (track_id, artist, title, cover, memo, is_public) on public.song_memos to authenticated;
grant update (memo, is_public, updated_at) on public.song_memos to authenticated;  -- 곡 정보·주인은 못 바꿈
grant delete on public.song_memos to authenticated;

-- 보기: 내 메모 + 남의 '공개' 메모
drop policy if exists "메모 보기" on public.song_memos;
create policy "메모 보기" on public.song_memos
  for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);

drop policy if exists "내 메모 쓰기" on public.song_memos;
create policy "내 메모 쓰기" on public.song_memos
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "내 메모 고치기" on public.song_memos;
create policy "내 메모 고치기" on public.song_memos
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "내 메모 지우기" on public.song_memos;
create policy "내 메모 지우기" on public.song_memos
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 수정 시각은 DB가 직접 기록 (사용자가 임의 시각을 넣지 못하게)
revoke update on public.song_memos from authenticated;
grant update (memo, is_public) on public.song_memos to authenticated;
create or replace function public.song_memos_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists song_memos_touch on public.song_memos;
create trigger song_memos_touch before update on public.song_memos
  for each row execute function public.song_memos_touch();
