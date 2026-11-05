// =====================================================
// B-SIDE 로그인 · 내 기록 (Supabase 이메일 + 비밀번호)
// - 비밀번호는 Supabase 서버가 bcrypt로 해시해서 저장한다 (우리 코드·DB 표에는 비밀번호가 없음)
// - 브라우저에는 '공개용 키'만 온다. 누가 무엇을 볼 수 있는지는 DB의 행 단위 보안(RLS)이 강제한다
// - 로그인하지 않아도 추천 기능은 그대로 쓸 수 있다
// =====================================================
(async function () {
  const $ = (sel) => document.querySelector(sel);
  let sb = null; // Supabase 연결 (설정이 없으면 로그인 기능만 숨기고 나머지는 그대로 동작)
  let authMode = "login";

  // 1) 서버에서 공개 설정을 받아 연결한다 (키를 코드에 직접 쓰지 않기 위해)
  try {
    const cfg = await (await fetch("/api/config", { cache: "no-store" })).json();
    if (cfg.supabaseUrl && cfg.supabaseKey && window.supabase) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true }, // 창을 닫았다 켜도 로그인 유지
      });
    }
  } catch (e) {
    console.warn("로그인 설정을 불러오지 못했어요:", e.message);
  }
  if (!sb) return; // 로그인 기능 없이 서비스는 그대로
  // 피드(feed.js)에서도 같은 연결을 쓰도록 알려준다
  window.bsideSb = sb;
  window.dispatchEvent(new Event("bside-ready"));

  // 2) 로그인 상태에 따라 상단 버튼 바꾸기
  function updateButtons(session) {
    $("#btn-open-login").hidden = !!session;
    $("#btn-logout").hidden = !session;
  }
  const { data } = await sb.auth.getSession();
  updateButtons(data.session);
  if (data.session) ensureProfile(data.session.user.id);
  sb.auth.onAuthStateChange((event, session) => {
    updateButtons(session);
    // 로그인 직후 닉네임이 있는지 확인 (콜백 안에서 바로 DB를 부르면 멈출 수 있어 잠깐 뒤로 미룸)
    if (event === "SIGNED_IN" && session) setTimeout(() => ensureProfile(session.user.id), 0);
  });

  // 닉네임 규칙 (DB에도 같은 규칙이 걸려 있음): 한글·영문·숫자·밑줄 2~16자
  const NICK_RE = /^[가-힣A-Za-z0-9_]{2,16}$/;

  async function nicknameTaken(nick) {
    const { data: rows } = await sb.from("profiles").select("id").eq("nickname", nick).limit(1);
    return !!(rows && rows.length);
  }

  // 닉네임(프로필)이 없으면 만들게 한다. 공개 기록에는 이메일 대신 이 닉네임만 보인다
  async function ensureProfile(uid) {
    const { data: rows } = await sb.from("profiles").select("nickname").eq("id", uid).limit(1);
    if (rows && rows.length) return rows[0].nickname;
    let nick = pendingNickname;
    pendingNickname = "";
    for (let tries = 0; tries < 5; tries++) {
      if (!nick) nick = (prompt("커뮤니티에서 쓸 닉네임을 정해 주세요. (한글·영문·숫자 2~16자)") || "").trim();
      if (!nick) return null; // 취소하면 나중에 다시 묻는다
      if (!NICK_RE.test(nick)) { alert("닉네임은 한글·영문·숫자 2~16자로 해 주세요."); nick = ""; continue; }
      const { error } = await sb.from("profiles").insert({ nickname: nick });
      if (!error) return nick;
      alert(/duplicate|unique/i.test(error.message) ? "이미 있는 닉네임이에요. 다른 걸로 해 주세요." : "닉네임을 저장하지 못했어요.");
      nick = "";
    }
    return null;
  }
  let pendingNickname = ""; // 가입할 때 입력한 닉네임 (가입 직후 프로필 만들 때 사용)
  window.bsideEnsureProfile = ensureProfile; // 노래 메모(song.js)에서도 닉네임 확인에 사용

  // 3) 로그인 / 회원가입 창
  const dialog = $("#login-dialog");
  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.auth === mode));
    $("#btn-login-submit").textContent = mode === "login" ? "로그인" : "가입하기";
    $("#signup-notice").hidden = mode !== "signup";
    $("#confirm-wrap").hidden = mode !== "signup";
    $("#nickname-wrap").hidden = mode !== "signup";
    $("#login-password2").value = "";
    $("#login-password").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("#login-message").textContent = "";
  }
  document.querySelectorAll(".auth-tab").forEach((t) => t.addEventListener("click", () => setAuthMode(t.dataset.auth)));
  $("#btn-open-login").addEventListener("click", () => {
    setAuthMode("login");
    $("#login-password").value = "";
    dialog.showModal();
  });
  $("#btn-login-cancel").addEventListener("click", () => dialog.close());

  // 비밀번호 규칙 (서버에도 같은 규칙이 걸려 있어서, 여기를 우회해도 서버가 거절한다)
  function checkPassword(pw) {
    if (pw.length < 8) return "비밀번호는 8자 이상이어야 해요.";
    if (pw.length > 72) return "비밀번호는 72자 이하로 해 주세요.";
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "영문과 숫자를 함께 써 주세요.";
    return "";
  }

  // 오류 메시지는 '이메일이 있는지 없는지' 알 수 없게 뭉뚱그려서 보여준다 (계정 존재 여부 노출 방지)
  function friendlyError(err) {
    const msg = (err && err.message) || "";
    if (/rate|too many|security purposes/i.test(msg)) return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
    if (/weak|password/i.test(msg) && authMode === "signup") return "더 안전한 비밀번호를 써 주세요. (8자 이상, 영문+숫자)";
    return authMode === "login" ? "이메일 또는 비밀번호가 맞지 않아요." : "가입하지 못했어요. 입력을 확인해 주세요.";
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const msg = $("#login-message");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (msg.textContent = "이메일 형식을 확인해 주세요.");
    if (authMode === "signup") {
      const bad = checkPassword(password);
      if (bad) return (msg.textContent = bad);
      // 비밀번호 확인: 두 칸이 같아야 가입
      if (password !== $("#login-password2").value) return (msg.textContent = "비밀번호가 서로 달라요. 다시 확인해 주세요.");
      const nick = $("#login-nickname").value.trim();
      if (!NICK_RE.test(nick)) return (msg.textContent = "닉네임은 한글·영문·숫자 2~16자로 해 주세요.");
      // 계정을 만들기 전에 닉네임이 겹치는지 먼저 확인
      if (await nicknameTaken(nick)) return (msg.textContent = "이미 있는 닉네임이에요. 다른 걸로 해 주세요.");
      pendingNickname = nick;
    }
    const btn = $("#btn-login-submit");
    btn.disabled = true;
    msg.textContent = "확인 중…";
    const { data, error } =
      authMode === "login"
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password });
    btn.disabled = false;
    $("#login-password").value = ""; // 비밀번호는 화면에 남기지 않는다
    $("#login-password2").value = "";
    if (error) return (msg.textContent = friendlyError(error));
    if (authMode === "signup" && !data.session) {
      msg.textContent = "가입 요청을 받았어요. 로그인해 주세요.";
      return setAuthMode("login");
    }
    dialog.close();
  });

  $("#btn-logout").addEventListener("click", async () => {
    await sb.auth.signOut();
    showStep("step-home");
  });

  // 4) 내 기록 저장 (app.js가 추천이 끝나면 부른다)
  window.saveRecord = async (mode, query, result) => {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return "guest"; // 로그인 안 했으면 저장하지 않음
    if (!(await ensureProfile(s.session.user.id))) return "no-nickname"; // 닉네임이 있어야 저장 (기록은 프로필에 연결됨)
    // 필요한 정보만 골라서 저장 (사진 주소 등은 빼고 크기를 작게)
    const bands = (result.bands || []).slice(0, 6).map((b) => ({
      name: b.name, genre: b.genre, reason: b.reason, discovered: !!b.discovered,
      songs: (b.songs || []).slice(0, 3).map((x) => x.title),
    }));
    const { error } = await sb.from("records").insert({
      mode: String(mode).slice(0, 30), query: String(query).slice(0, 2000),
      summary: String(result.summary || "").slice(0, 500), tags: (result.tags || []).slice(0, 6), bands,
    });
    if (error) {
      console.warn("기록 저장 실패:", error.message);
      return "error";
    }
    return "saved";
  };

  // 5) 내 기록 보기 · 삭제
  async function showRecords() {
    const list = $("#records-list");
    list.textContent = "불러오는 중…";
    showStep("step-records");
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return (list.textContent = "로그인이 필요해요.");
    // DB 규칙상 남의 '공개' 기록도 읽을 수 있으므로, 여기서는 반드시 '내 것'만 고른다
    const { data: rows, error } = await sb
      .from("records").select("id, query, summary, tags, bands, created_at, is_public")
      .eq("user_id", s.session.user.id)
      .order("created_at", { ascending: false }).limit(50);
    list.textContent = "";
    if (error) return (list.textContent = "기록을 불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 저장된 기록이 없어요. 추천을 받아 보세요!");
    rows.forEach((r) => {
      // AI가 만든 글이 섞여 있으므로 innerHTML 대신 textContent로만 넣는다 (스크립트 삽입 방지)
      const item = document.createElement("article");
      item.className = "record";
      const date = document.createElement("time");
      date.textContent = new Date(r.created_at).toLocaleString("ko-KR");
      const q = document.createElement("p");
      q.className = "record-query";
      q.textContent = r.query;
      const sum = document.createElement("p");
      sum.className = "record-summary";
      sum.textContent = r.summary || "";
      const artists = document.createElement("p");
      artists.className = "record-artists";
      artists.textContent = (r.bands || []).map((b) => (b.discovered ? "✦ " : "") + b.name).join(" · ");
      const del = document.createElement("button");
      del.className = "btn-small ghost";
      del.textContent = "삭제";
      del.addEventListener("click", async () => {
        if (!confirm("이 기록을 지울까요?")) return;
        const { error: e } = await sb.from("records").delete().eq("id", r.id);
        if (!e) item.remove();
      });
      // 공개 / 비공개 전환 (DB 규칙상 내 기록의 '공개 여부' 칸만 바꿀 수 있음)
      const vis = document.createElement("button");
      vis.className = "btn-small" + (r.is_public ? "" : " ghost");
      const paint = () => {
        vis.textContent = r.is_public ? "🌐 공개" : "🔒 비공개";
        vis.className = "btn-small" + (r.is_public ? "" : " ghost");
        vis.title = r.is_public ? "다른 사람도 닉네임과 함께 볼 수 있어요. 누르면 비공개로" : "나만 볼 수 있어요. 누르면 공개로";
      };
      paint();
      vis.addEventListener("click", async () => {
        const next = !r.is_public;
        if (next && !confirm("이 기록을 공개할까요? 다른 사람이 닉네임과 함께 볼 수 있어요. (이메일은 보이지 않아요)")) return;
        vis.disabled = true;
        const { error: e } = await sb.from("records").update({ is_public: next }).eq("id", r.id);
        vis.disabled = false;
        if (e) return alert("바꾸지 못했어요. 잠시 후 다시 해 주세요.");
        r.is_public = next;
        paint();
      });
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(vis, del);
      item.append(date, q, sum, artists, actions);
      list.appendChild(item);
    });
  }
  window.showRecords = showRecords; // 홈의 '기록'에서 사용 (hub.js)
})();
