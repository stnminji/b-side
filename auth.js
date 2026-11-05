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

  // 2) 로그인 상태에 따라 상단 버튼 바꾸기
  function updateButtons(session) {
    $("#btn-open-login").hidden = !!session;
    $("#btn-my-records").hidden = !session;
    $("#btn-logout").hidden = !session;
  }
  const { data } = await sb.auth.getSession();
  updateButtons(data.session);
  sb.auth.onAuthStateChange((_event, session) => updateButtons(session));

  // 3) 로그인 / 회원가입 창
  const dialog = $("#login-dialog");
  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.auth === mode));
    $("#btn-login-submit").textContent = mode === "login" ? "로그인" : "가입하기";
    $("#signup-notice").hidden = mode !== "signup";
    $("#confirm-wrap").hidden = mode !== "signup";
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
    showStep("step-input");
  });

  // 4) 내 기록 저장 (app.js가 추천이 끝나면 부른다)
  window.saveRecord = async (mode, query, result) => {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return; // 로그인 안 했으면 저장하지 않음
    // 필요한 정보만 골라서 저장 (사진 주소 등은 빼고 크기를 작게)
    const bands = (result.bands || []).slice(0, 6).map((b) => ({
      name: b.name, genre: b.genre, reason: b.reason, discovered: !!b.discovered,
      songs: (b.songs || []).slice(0, 3).map((x) => x.title),
    }));
    const { error } = await sb.from("records").insert({
      mode: String(mode).slice(0, 30), query: String(query).slice(0, 2000),
      summary: String(result.summary || "").slice(0, 500), tags: (result.tags || []).slice(0, 6), bands,
    });
    if (error) console.warn("기록 저장 실패:", error.message);
  };

  // 5) 내 기록 보기 · 삭제
  async function showRecords() {
    const list = $("#records-list");
    list.textContent = "불러오는 중…";
    showStep("step-records");
    const { data: rows, error } = await sb
      .from("records").select("id, query, summary, tags, bands, created_at")
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
      item.append(date, q, sum, artists, del);
      list.appendChild(item);
    });
  }
  $("#btn-my-records").addEventListener("click", showRecords);
})();
