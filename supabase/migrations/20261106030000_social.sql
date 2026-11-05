-- B-SIDE 소셜: 자유 메모 · 좋아요 · 댓글 · 취향 이웃
-- 핵심 보안 원칙: '공개' 글(또는 내 글)만 보이고, 좋아요·댓글도 볼 수 있는 글에만 달 수 있다.
--   → 비공개 글은 내용은 물론 '있다는 사실'(좋아요 수, 댓글)도 남에게 드러나지 않는다.

-- ---------- 1. 자유 메모 (노래와 상관없는 음악 일기) ----------
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, created_at desc);
create index if not exists notes_public_idx on public.notes (created_at desc) where is_public;

alter table public.notes enable row level security;
alter table public.notes force row level security;
revoke all on public.notes from anon, authenticated;
grant select on public.notes to anon, authenticated;
grant insert (body, is_public) on public.notes to authenticated;
grant update (is_public) on public.notes to authenticated;
grant delete on public.notes to authenticated;

drop policy if exists "자유 메모 보기" on public.notes;
create policy "자유 메모 보기" on public.notes for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);
drop policy if exists "내 자유 메모 쓰기" on public.notes;
create policy "내 자유 메모 쓰기" on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "내 자유 메모 공개 설정" on public.notes;
create policy "내 자유 메모 공개 설정" on public.notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "내 자유 메모 지우기" on public.notes;
create policy "내 자유 메모 지우기" on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- 2. '이 글을 볼 수 있나?' 확인 함수 ----------
-- security invoker: 부르는 사람의 권한(RLS)으로 확인 → 볼 수 없는 글이면 false
create or replace function public.can_see_target(t text, target uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select case t
    when 'record'    then exists (select 1 from public.records    where id = target)
    when 'song_memo' then exists (select 1 from public.song_memos where id = target)
    when 'note'      then exists (select 1 from public.notes      where id = target)
    else false end;
$$;
grant execute on function public.can_see_target(text, uuid) to anon, authenticated;

-- ---------- 3. 좋아요 ----------
create table if not exists public.likes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('record', 'song_memo', 'note')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (user_id, target_type, target_id)   -- 한 사람이 같은 글에 좋아요 한 번만
);
create index if not exists likes_target_idx on public.likes (target_type, target_id);

alter table public.likes enable row level security;
alter table public.likes force row level security;
revoke all on public.likes from anon, authenticated;
grant select on public.likes to anon, authenticated;
grant insert (target_type, target_id) on public.likes to authenticated;
grant delete on public.likes to authenticated;

drop policy if exists "좋아요 보기" on public.likes;
create policy "좋아요 보기" on public.likes for select to anon, authenticated
  using (public.can_see_target(target_type, target_id));
drop policy if exists "좋아요 누르기" on public.likes;
create policy "좋아요 누르기" on public.likes for insert to authenticated
  with check ((select auth.uid()) = user_id and public.can_see_target(target_type, target_id));
drop policy if exists "좋아요 취소" on public.likes;
create policy "좋아요 취소" on public.likes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- 4. 댓글 ----------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('record', 'song_memo', 'note')),
  target_id   uuid not null,
  body        text not null check (char_length(body) between 1 and 300),
  created_at  timestamptz not null default now()
);
create index if not exists comments_target_idx on public.comments (target_type, target_id, created_at);

alter table public.comments enable row level security;
alter table public.comments force row level security;
revoke all on public.comments from anon, authenticated;
grant select on public.comments to anon, authenticated;
grant insert (target_type, target_id, body) on public.comments to authenticated;
grant delete on public.comments to authenticated;   -- 수정은 없음 (지우고 다시 쓰기)

drop policy if exists "댓글 보기" on public.comments;
create policy "댓글 보기" on public.comments for select to anon, authenticated
  using (public.can_see_target(target_type, target_id));
drop policy if exists "댓글 쓰기" on public.comments;
create policy "댓글 쓰기" on public.comments for insert to authenticated
  with check ((select auth.uid()) = user_id and public.can_see_target(target_type, target_id));
drop policy if exists "내 댓글 지우기" on public.comments;
create policy "내 댓글 지우기" on public.comments for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 글을 지우면 그 글의 좋아요·댓글도 함께 지운다 (남은 흔적 방지)
create or replace function public.cleanup_social() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.likes    where target_type = tg_argv[0] and target_id = old.id;
  delete from public.comments where target_type = tg_argv[0] and target_id = old.id;
  return old;
end $$;
revoke all on function public.cleanup_social() from public, anon, authenticated;
drop trigger if exists records_cleanup on public.records;
create trigger records_cleanup after delete on public.records for each row execute function public.cleanup_social('record');
drop trigger if exists song_memos_cleanup on public.song_memos;
create trigger song_memos_cleanup after delete on public.song_memos for each row execute function public.cleanup_social('song_memo');
drop trigger if exists notes_cleanup on public.notes;
create trigger notes_cleanup after delete on public.notes for each row execute function public.cleanup_social('note');

-- ---------- 5. 취향 이웃: 내 서재와 '공개 서재'가 겹치는 사람 ----------
-- security invoker → 부르는 사람의 RLS 그대로: 남의 비공개 서재는 계산에 들어갈 수 없음
create or replace function public.similar_users(lim int default 10)
returns table (user_id uuid, nickname text, shared int, artists text[])
language sql stable security invoker set search_path = '' as $$
  with mine as (
    select distinct artist_id, artist from public.library
    where user_id = auth.uid() and artist_id is not null
  ), theirs as (
    select distinct l.user_id, l.artist_id from public.library l
    where l.is_public and l.user_id <> auth.uid() and l.artist_id is not null
  )
  select t.user_id, p.nickname, count(*)::int as shared, array_agg(distinct m.artist) as artists
  from theirs t
  join mine m on m.artist_id = t.artist_id
  join public.profiles p on p.id = t.user_id
  group by t.user_id, p.nickname
  order by shared desc, p.nickname
  limit least(greatest(lim, 1), 30);
$$;
revoke all on function public.similar_users(int) from public, anon;
grant execute on function public.similar_users(int) to authenticated;
