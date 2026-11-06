// =====================================================
// 결 · 나의 페이지
// - 지금 어떤 계정으로 로그인했는지 (닉네임 · 이메일 · 가입일)
// - 내 기록 수 (노래 감상 · 아티스트 감상 · 좋아요한 아티스트, 그중 공개)
// - 나의 취향 분석 요약 · 연결 동의 상태
// - 닉네임 바꾸기 · 내 공개 프로필 보기 · 로그아웃
// 내 데이터만 읽는다 (DB 규칙상 남의 비공개는 어차피 읽히지 않음)
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);
  const sb = () => window.bsideSb;
  const NICK_RE = /^[가-힣A-Za-z0-9_]{2,16}$/;
  let me = null; // { id, email, created_at, nickname }

  // 상단 '@닉네임' 버튼: 로그인 상태가 바뀔 때마다 갱신 (auth.js가 부름)
  window.paintMeButton = async (session) => {
    const btn = $("#btn-me");
    if (!session) {
      btn.hidden = true;
      me = null;
      return;
    }
    const { data } = await sb().from("profiles").select("nickname").eq("id", session.user.id).limit(1);
    const nick = data && data.length ? data[0].nickname : null;
    me = { id: session.user.id, email: session.user.email, created_at: session.user.created_at, nickname: nick };
    btn.textContent = nick ? "@" + nick : "내 계정";
    btn.title = "나의 페이지 · " + (session.user.email || "");
    btn.hidden = false;
  };

  $("#btn-me").addEventListener("click", () => openMe());

  async function openMe() {
    const { data: s } = await sb().auth.getSession();
    if (!s.session) return $("#btn-open-login").click();
    await window.paintMeButton(s.session);
    if (window.rememberPage) window.rememberPage();
    showStep("step-me");
    // 계정 정보
    $("#me-nick").textContent = me.nickname ? "@" + me.nickname : "닉네임 없음";
    $("#me-email").textContent = me.email || "";
    $("#me-joined").textContent = me.created_at ? new Date(me.created_at).toLocaleDateString("ko-KR") + " 가입" : "";
    $("#me-nick-input").value = me.nickname || "";
    $("#me-nick-status").textContent = "";
    // 내 기록 수 (전체 / 공개)
    const client = sb();
    const count = (table, onlyPublic) => {
      let q = client.from(table).select("id", { count: "exact", head: true }).eq("user_id", me.id);
      if (onlyPublic) q = q.eq("is_public", true);
      return q;
    };
    const [sm, smp, am, amp, fav] = await Promise.all([
      count("song_memos"), count("song_memos", true), count("artist_memos"), count("artist_memos", true), count("favorite_artists"),
    ]);
    $("#me-stats").innerHTML = "";
    // 누르면 나의 음악 저장소의 해당 탭으로 (memos: 음악 / artists: 아티스트 — 좋아요와 감상이 함께 보임)
    [
      ["노래 감상", sm.count, smp.count, "memos"],
      ["아티스트 감상", am.count, amp.count, "artists"],
      ["좋아요한 아티스트", fav.count, null, "artists"],
    ].forEach(([label, all, pub, tab]) => {
      const box = document.createElement("button");
      box.type = "button";
      box.className = "me-stat";
      box.title = "나의 음악 저장소에서 보기";
      box.addEventListener("click", async () => {
        if (window.rememberPage) window.rememberPage();
        await window.showRecords();
        window.selectRecordsTab(tab);
      });
      const n = document.createElement("b");
      n.textContent = all || 0;
      const l = document.createElement("span");
      l.textContent = label + (pub !== null ? ` · 공개 ${pub || 0}` : "");
      box.append(n, l);
      $("#me-stats").appendChild(box);
    });
    // 나의 취향 분석
    const { data: tp } = await client.from("taste_profiles").select("summary, consent, updated_at").eq("user_id", me.id).limit(1);
    const t = tp && tp.length ? tp[0] : null;
    $("#me-taste").textContent = t ? t.summary : "아직 취향 분석이 없어요. '취향으로 연결'에서 AI로 분석해 보세요.";
    $("#me-consent").textContent = t ? (t.consent ? "다른 사람과 연결: 켜짐" : "다른 사람과 연결: 꺼짐") : "";
  }

  // 닉네임 바꾸기 (DB 규칙: 내 닉네임만, 한글·영문·숫자 2~16자, 중복 불가)
  $("#me-nick-save").addEventListener("click", async () => {
    const nick = $("#me-nick-input").value.trim();
    const status = $("#me-nick-status");
    if (!NICK_RE.test(nick)) return (status.textContent = "닉네임은 한글·영문·숫자 2~16자로 해 주세요.");
    if (nick === me.nickname) return (status.textContent = "지금 닉네임과 같아요.");
    const { error } = me.nickname
      ? await sb().from("profiles").update({ nickname: nick }).eq("id", me.id)
      : await sb().from("profiles").insert({ nickname: nick });
    if (error) return (status.textContent = /duplicate|unique/i.test(error.message) ? "이미 있는 닉네임이에요." : "바꾸지 못했어요.");
    me.nickname = nick;
    $("#me-nick").textContent = "@" + nick;
    $("#btn-me").textContent = "@" + nick;
    status.textContent = "✓ 닉네임을 바꿨어요.";
  });

  $("#me-public").addEventListener("click", () => me && window.openProfile(me.id));
  $("#me-logout").addEventListener("click", () => $("#btn-logout").click());
})();
