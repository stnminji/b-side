-- B-SIDE: 좋아하는 아티스트 (아티스트 페이지의 ♡)
-- - 아티스트는 Deezer 아티스트 번호로 구분, 사용자당 같은 아티스트는 한 번만 (중복 방지)
-- - 기본 비공개. '공개'로 표시한 사람만 아티스트 페이지의 'B-SIDE 팬'·'좋아하는 사람'에 나온다
-- - 새 표만 추가 (기존 표·데이터는 건드리지 않음)

create table if not exists public.favorite_artists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  artist_id  bigint not null check (artist_id > 0),
  name       text not null check (char_length(name) between 1 and 100),
  picture    text check (picture is null or (picture like 'https://%' and char_length(picture) <= 300)),
  is_public  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, artist_id)
);
create index if not exists favorite_artists_artist_idx on public.favorite_artists (artist_id) where is_public;
create index if not exists favorite_artists_user_idx on public.favorite_artists (user_id, created_at desc);

alter table public.favorite_artists enable row level security;
alter table public.favorite_artists force row level security;
revoke all on public.favorite_artists from anon, authenticated;
grant select on public.favorite_artists to anon, authenticated;
grant insert (artist_id, name, picture, is_public) on public.favorite_artists to authenticated;
grant update (is_public) on public.favorite_artists to authenticated;   -- 공개 여부만 바꿀 수 있음
grant delete on public.favorite_artists to authenticated;

drop policy if exists "좋아하는 아티스트 보기" on public.favorite_artists;
create policy "좋아하는 아티스트 보기" on public.favorite_artists for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);
drop policy if exists "좋아하는 아티스트 추가" on public.favorite_artists;
create policy "좋아하는 아티스트 추가" on public.favorite_artists for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "좋아하는 아티스트 공개 설정" on public.favorite_artists;
create policy "좋아하는 아티스트 공개 설정" on public.favorite_artists for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "좋아하는 아티스트 취소" on public.favorite_artists;
create policy "좋아하는 아티스트 취소" on public.favorite_artists for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 팬 수 집계: 이 아티스트에 ♡를 누른 사람 '수'만 돌려준다 (누가 눌렀는지는 절대 돌려주지 않음)
-- 남의 ♡ 행은 RLS로 읽을 수 없으므로, 숫자 하나만 내주는 함수로 집계한다 (security definer, 결과는 정수 1개)
create or replace function public.artist_fan_count(aid bigint) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.favorite_artists where artist_id = aid;
$$;
revoke all on function public.artist_fan_count(bigint) from public;
grant execute on function public.artist_fan_count(bigint) to anon, authenticated;
