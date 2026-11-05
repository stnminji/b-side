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
    $("#btn-feed").hidden = false;
    $("#btn-feed").addEventListener("click", () => showFeed(sb));
  }
  window.addEventListener("bside-ready", start);
  start(); // auth.js가 먼저 준비됐을 수도 있음

  async function showFeed(sb) {
    const list = $("#feed-list");
    list.textContent = "불러오는 중…";
    showStep("step-feed");
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
    if (!rows.length) return (list.textContent = "아직 공개된 기록이 없어요. 내 기록에서 🌐 공개로 바꿔 첫 번째가 되어 보세요!");

    rows.forEach((r) => {
      // 다른 사람이 쓴 글이므로 textContent로만 넣는다 (스크립트 삽입 방지)
      const item = document.createElement("article");
      item.className = "record";
      const who = document.createElement("p");
      who.className = "record-who";
      who.textContent = "@" + ((r.profiles && r.profiles.nickname) || "익명") + " · " + new Date(r.created_at).toLocaleDateString("ko-KR");
      const q = document.createElement("p");
      q.className = "record-query";
      q.textContent = r.query;
      const sum = document.createElement("p");
      sum.className = "record-summary";
      sum.textContent = r.summary || "";
      const artists = document.createElement("p");
      artists.className = "record-artists";
      artists.textContent = (r.bands || []).map((b) => (b.discovered ? "✦ " : "") + b.name).join(" · ");
      item.append(who, q, sum, artists);
      if (r.user_id !== myId) {
        const btn = document.createElement("button");
        btn.className = "btn-small";
        btn.textContent = "🔗 나와 비교";
        btn.addEventListener("click", () => compareWith(sb, r));
        item.appendChild(btn);
      } else {
        const mine = document.createElement("span");
        mine.className = "hint small";
        mine.textContent = "내 기록";
        item.appendChild(mine);
      }
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
    $("#loading-text").textContent = "두 사람의 취향을 비교하고 있어요…";
    let result;
    try {
      result = await callAI({ action: "compare", target_id: record.id, token: s.session.access_token });
    } catch (e) {
      alert(e.message || "비교하지 못했어요. 잠시 후 다시 해 주세요.");
      return showFeed(sb);
    }
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
