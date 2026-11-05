-- B-SIDE: 닉네임(프로필) + 기록 공개/비공개
-- 보안 원칙
--   1) 기록은 기본 '비공개'. 사용자가 직접 고른 기록만 공개된다.
--   2) 공개 화면에는 이메일이 아니라 닉네임만 보인다. (이메일은 auth.users에만 있고 공개되지 않음)
--   3) 공개 여부는 '자기 기록'만, 그리고 'is_public' 칸만 바꿀 수 있다. (기록 내용은 수정 불가)

-- ---------- 1. 프로필 (닉네임) ----------
create table if not exists public.profiles (
  id         uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nickname   text not null unique
             check (nickname ~ '^[가-힣A-Za-z0-9_]{2,16}$'),  -- 한글·영문·숫자·밑줄 2~16자 (특수문자·공백·스크립트 차단)
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;        -- 닉네임은 공개 정보
grant insert (nickname) on public.profiles to authenticated;   -- id는 DB가 로그인 정보로 채움
grant update (nickname) on public.profiles to authenticated;   -- 닉네임만 바꿀 수 있음

drop policy if exists "닉네임 보기" on public.profiles;
create policy "닉네임 보기" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "내 프로필 만들기" on public.profiles;
create policy "내 프로필 만들기" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "내 닉네임 바꾸기" on public.profiles;
create policy "내 닉네임 바꾸기" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- ---------- 2. 기록 공개 여부 ----------
alter table public.records add column if not exists is_public boolean not null default false;

-- 공개 기록 목록을 빠르게 찾기 위한 색인
create index if not exists records_public_created_idx on public.records (created_at desc) where is_public;

-- 공개 기록 → 닉네임을 붙이기 위해 profiles와 연결 (user_id = profiles.id)
alter table public.records drop constraint if exists records_user_profile_fk;
alter table public.records
  add constraint records_user_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade not valid;

-- 보기: 내 기록 + 남의 '공개' 기록 (로그인 안 한 사람은 공개 기록만)
grant select on public.records to anon;
drop policy if exists "내 기록 보기" on public.records;
drop policy if exists "기록 보기" on public.records;
create policy "기록 보기" on public.records
  for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);

-- 수정: 내 기록의 '공개 여부' 칸만
revoke update on public.records from authenticated;
grant update (is_public) on public.records to authenticated;
drop policy if exists "내 기록 공개 설정" on public.records;
create policy "내 기록 공개 설정" on public.records
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
