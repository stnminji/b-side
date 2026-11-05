// =====================================================
// B-SIDE 디깅 피드 + 취향 교집합
// - 피드: 사람들이 '공개'로 바꾼 기록만 보인다 (DB의 행 단위 보안이 비공개 기록을 막음)
// - 나와 비교: 서버가 내 로그인 토큰으로 기록을 직접 가져와 AI가 비교한다
//   (브라우저가 보낸 기록 내용은 믿지 않음 → 남의 비공개 기록 비교·조작 불가)
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);

  function start() {
    const sb = window.bsideSb;
    if (!sb || start.done) return;
    start.done = true;
    window.openFeed = () => showFeed(sb); // 홈의 '소셜'에서 사용 (hub.js)
  }
  window.addEventListener("bside-ready", start);
  start(); // auth.js가 먼저 준비됐을 수도 있음

  // 피드 탭: 추천 기록 / 노래 감상 / 자유 메모 / 취향 이웃
  const FEED_TABS = { records: "#feed-list", memos: "#feed-memos", notes: "#feed-notes", neighbors: "#feed-neighbors" };
  function selectFeedTab(tab) {
    document.querySelectorAll(".feed-tab").forEach((b) => {
      const on = b.dataset.ftab === tab;
      b.classList.toggle("active", on);
      b.classList.toggle("ghost", !on);
    });
    Object.entries(FEED_TABS).forEach(([t, sel]) => ($(sel).hidden = t !== tab));
    if (tab === "records") loadRecordFeed(window.bsideSb);
    if (tab === "memos") loadMemoFeed(window.bsideSb);
    if (tab === "notes") loadNoteFeed(window.bsideSb);
    if (tab === "neighbors") window.loadNeighbors($("#feed-neighbors"));
  }
  document.querySelectorAll(".feed-tab").forEach((b) => b.addEventListener("click", () => selectFeedTab(b.dataset.ftab)));

  // 글 위쪽: @닉네임(누르면 공개 프로필) · 날짜
  function header(r, date) {
    const who = document.createElement("p");
    who.className = "record-who";
    who.append(window.nickButton(r.profiles && r.profiles.nickname, r.user_id), " · " + new Date(date).toLocaleDateString("ko-KR"));
    return who;
  }
  function text(tag, cls, value) {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = value; // 다른 사람이 쓴 글 → textContent로만
    return e;
  }

  // 사람들이 '공개'로 저장한 노래 메모 (최신순). 노래를 누르면 그 노래 페이지로
  async function loadMemoFeed(sb) {
    const list = $("#feed-memos");
    list.textContent = "불러오는 중…";
    const { data: rows, error } = await sb.from("song_memos")
      .select("id, user_id, track_id, artist, title, cover, memo, updated_at, profiles(nickname)")
      .eq("is_public", true).order("updated_at", { ascending: false }).limit(30);
    list.textContent = "";
    if (error) return (list.textContent = "감상을 불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 공개된 노래 감상이 없어요. 노래 페이지에서 메모를 '공개'로 저장해 보세요!");
    const counts = await window.loadSocialCounts(rows.map((r) => r.id));
    rows.forEach((r) => {
      const item = document.createElement("article");
      item.className = "record";
      item.append(header(r, r.updated_at), window.trackRow(r), text("p", "record-summary", r.memo), window.socialBar("song_memo", r.id, counts[r.id]));
      list.appendChild(item);
    });
  }

  // 공개 자유 메모
  async function loadNoteFeed(sb) {
    const list = $("#feed-notes");
    list.textContent = "불러오는 중…";
    const { data: rows, error } = await sb.from("notes")
      .select("id, user_id, body, created_at, profiles(nickname)")
      .eq("is_public", true).order("created_at", { ascending: false }).limit(30);
    list.textContent = "";
    if (error) return (list.textContent = "자유 메모를 불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 공개된 자유 메모가 없어요. 기록 → 자유 메모에서 '공개'로 남겨 보세요!");
    const counts = await window.loadSocialCounts(rows.map((r) => r.id));
    rows.forEach((r) => {
      const item = document.createElement("article");
      item.className = "record";
      item.append(header(r, r.created_at), text("p", "record-summary", r.body), window.socialBar("note", r.id, counts[r.id]));
      list.appendChild(item);
    });
  }

  async function showFeed(sb) {
    showStep("step-feed");
    selectFeedTab("records");
  }

  // 공개 추천 기록 (+ 나와 비교)
  async function loadRecordFeed(sb) {
    const list = $("#feed-list");
    list.textContent = "불러오는 중…";
    const { data: s } = await sb.auth.getSession();
    const myId = s.session ? s.session.user.id : null;
    const { data: rows, error } = await sb
      .from("records")
      .select("id, user_id, query, summary, tags, bands, created_at, profiles(nickname)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(30);
    list.textContent = "";
    if (error) return (list.textContent = "피드를 불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 공개된 기록이 없어요. 내 기록에서 '공개'로 바꿔 첫 번째가 되어 보세요!");
    const counts = await window.loadSocialCounts(rows.map((r) => r.id));
    rows.forEach((r) => {
      const item = document.createElement("article");
      item.className = "record";
      item.append(
        header(r, r.created_at),
        text("p", "record-query", r.query),
        text("p", "record-summary", r.summary || ""),
        text("p", "record-artists", (r.bands || []).map((b) => (b.discovered ? "✦ " : "") + b.name).join(" · "))
      );
      if (r.user_id !== myId) {
        const btn = document.createElement("button");
        btn.className = "btn-small";
        btn.innerHTML = ic("link") + "나와 비교";
        btn.addEventListener("click", () => compareWith(sb, r));
        item.appendChild(btn);
      }
      item.appendChild(window.socialBar("record", r.id, counts[r.id]));
      list.appendChild(item);
    });
  }

  async function compareWith(sb, record) {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) {
      alert("취향 비교는 로그인 후에 쓸 수 있어요.");
      return $("#btn-open-login").click();
    }
    showStep("step-loading");
    startLoadingSteps("두 사람의 취향을 비교하고 있어요…");
    let result;
    try {
      result = await callAI({ action: "compare", target_id: record.id, token: s.session.access_token });
    } catch (e) {
      stopLoadingSteps();
      alert(e.message || "비교하지 못했어요. 잠시 후 다시 해 주세요.");
      return showFeed(sb);
    }
    stopLoadingSteps();
    // 결과 화면은 추천 결과 화면을 같이 쓰고, 위에 '취향 비교' 상자를 켠다
    lastSearch = null; // 비교 결과에는 '더 찾아보기'를 쓰지 않음
    renderResult({ summary: result.summary, tags: result.tags, bands: result.bands });
    $("#btn-more").hidden = true;
    $(".result-title").textContent = "둘 다 좋아할 아티스트";
    const box = $("#compare-box");
    box.hidden = false;
    box.querySelector(".compare-who").textContent = "나 × @" + (result.nickname || "상대");
    box.querySelector(".compare-meter span").style.width = result.score + "%";
    box.querySelector(".compare-score").textContent = "취향 교집합 " + result.score + "%";
    box.querySelector(".compare-common").textContent = result.common;
    box.querySelector(".compare-diff").textContent = result.difference;
    showStep("step-result");
  }
})();
