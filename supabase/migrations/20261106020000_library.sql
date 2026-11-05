-- B-SIDE: 내 음악 서재 (노래 담기)
-- - 곡은 Deezer 곡 번호(track_id)로 구분 + 국제 음원 코드(ISRC)도 함께 저장
-- - 사용자당 같은 곡은 한 번만 (unique) → 중복 등록 방지
-- - 기본 비공개. 나중에 소셜(다른 사람 서재 구경)에서 '공개'만 보이게 (records·song_memos와 같은 구조)

create table if not exists public.library (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  track_id     bigint not null check (track_id > 0),
  isrc         text check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  artist_id    bigint check (artist_id is null or artist_id > 0),
  artist       text not null check (char_length(artist) between 1 and 100),
  title        text not null check (char_length(title) between 1 and 200),
  album        text check (album is null or char_length(album) <= 200),
  release_date text check (release_date is null or release_date ~ '^[0-9]{4}(-[0-9]{2}){0,2}$'),
  cover        text check (cover is null or (cover like 'https://%' and char_length(cover) <= 300)),
  is_public    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, track_id)
);

create index if not exists library_user_created_idx on public.library (user_id, created_at desc);

alter table public.library enable row level security;
alter table public.library force row level security;

revoke all on public.library from anon, authenticated;
grant select on public.library to anon, authenticated;
grant insert (track_id, isrc, artist_id, artist, title, album, release_date, cover, is_public) on public.library to authenticated;
grant update (is_public) on public.library to authenticated;   -- 담은 곡 정보는 못 바꿈, 공개 여부만
grant delete on public.library to authenticated;

drop policy if exists "서재 보기" on public.library;
create policy "서재 보기" on public.library
  for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);

drop policy if exists "내 서재에 담기" on public.library;
create policy "내 서재에 담기" on public.library
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "내 서재 공개 설정" on public.library;
create policy "내 서재 공개 설정" on public.library
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "내 서재에서 빼기" on public.library;
create policy "내 서재에서 빼기" on public.library
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 메모에도 국제 음원 코드(ISRC)를 함께 남길 수 있게 (같은 곡 판별 보조)
alter table public.song_memos add column if not exists isrc text
  check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$');
grant insert (isrc) on public.song_memos to authenticated;
