-- B-SIDE: 감상 결(취향 프로필) + 연결 동의
-- - AI가 '내' 감상 메모·저장 곡·좋아하는 아티스트를 읽고 만든 요약 (내 로그인 권한으로만 만들어짐)
-- - 연결 동의(consent)는 기본 꺼짐. 켠 사람의 '요약'만 다른 로그인 사용자와 AI 매칭에 쓰인다
-- - 비공개 메모·창고 원문은 남에게 절대 전달되지 않음 (공유되는 건 이 요약뿐)
-- - 새 표만 추가 (기존 표·데이터는 건드리지 않음)

create table if not exists public.taste_profiles (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  summary    text not null check (char_length(summary) between 1 and 300),
  tags       text[] not null default '{}' check (cardinality(tags) <= 8),
  consent    boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists taste_profiles_consent_idx on public.taste_profiles (updated_at desc) where consent;

alter table public.taste_profiles enable row level security;
alter table public.taste_profiles force row level security;
revoke all on public.taste_profiles from anon, authenticated;
grant select on public.taste_profiles to authenticated;                         -- 비로그인은 볼 수 없음
grant insert (summary, tags, consent) on public.taste_profiles to authenticated;
grant update (summary, tags, consent) on public.taste_profiles to authenticated;
grant delete on public.taste_profiles to authenticated;

-- 보기: 내 것 + '연결에 동의한' 사람의 요약만
drop policy if exists "감상 결 보기" on public.taste_profiles;
create policy "감상 결 보기" on public.taste_profiles for select to authenticated
  using (consent or (select auth.uid()) = user_id);
drop policy if exists "내 감상 결 만들기" on public.taste_profiles;
create policy "내 감상 결 만들기" on public.taste_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "내 감상 결 고치기" on public.taste_profiles;
create policy "내 감상 결 고치기" on public.taste_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "내 감상 결 지우기" on public.taste_profiles;
create policy "내 감상 결 지우기" on public.taste_profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 갱신 시각은 DB가 기록
create or replace function public.taste_profiles_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists taste_profiles_touch on public.taste_profiles;
create trigger taste_profiles_touch before update on public.taste_profiles
  for each row execute function public.taste_profiles_touch();
