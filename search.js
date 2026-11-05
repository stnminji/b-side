// =====================================================
// B-SIDE 노래·아티스트 검색
// - 첫 화면 검색창 → 결과 목록(아티스트 / 노래) → 누르면 아티스트 페이지 / 노래 페이지
// - 결과는 전부 음악 DB(Deezer)의 실제 데이터 (AI를 쓰지 않아 빠름)
// - '뒤로' 버튼: 검색 결과 → 노래 → 아티스트 사이를 왔다 갔다 할 수 있게 방문 순서를 기억
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);
  const PAGES = ["step-search", "step-song", "step-artist", "step-records"];
  const history = []; // 지나온 페이지 (검색 결과·노래·아티스트만)

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // 지금 보이는 페이지를 기억해 두고, 다른 페이지로 갈 때 쓴다
  function currentPage() {
    return PAGES.find((id) => !$("#" + id).hidden) || null;
  }
  window.rememberPage = () => {
    const now = currentPage();
    if (now && history[history.length - 1] !== now) history.push(now);
  };
  window.goBack = () => {
    const prev = history.pop();
    showStep(prev || "step-input");
  };
  // 처음 화면으로 가면 기록을 비운다
  document.querySelectorAll(".go-home").forEach((b) => b.addEventListener("click", () => (history.length = 0)));

  // ----- 검색 -----
  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#search-q").value.trim();
    if (!q) return $("#search-q").focus();
    history.length = 0;
    showStep("step-loading");
    startLoadingSteps("음악 데이터베이스에서 찾고 있어요…");
    let result;
    try {
      result = await callAI({ action: "search", q });
    } catch (err) {
      stopLoadingSteps();
      alert(err.message || "검색하지 못했어요. 잠시 후 다시 해 주세요.");
      return showStep("step-input");
    }
    stopLoadingSteps();
    renderResults(q, result);
    showStep("step-search");
  });

  function renderResults(q, result) {
    $("#search-title").textContent = `'${q}' 검색 결과`;
    // 아티스트
    const artists = $("#search-artists");
    artists.innerHTML = "";
    if (!result.artists.length) artists.appendChild(el("p", "hint small", "찾은 아티스트가 없어요."));
    result.artists.forEach((a) => {
      const b = el("button", "track-row");
      if (a.picture) {
        const img = el("img", "track-cover round");
        img.src = a.picture;
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
      }
      const text = el("span", "track-text");
      const sub = [a.name_db !== a.name ? a.name_db : "", a.fans ? `팬 ${a.fans.toLocaleString()}명` : "", a.curated ? "B-SIDE 큐레이션" : ""]
        .filter(Boolean).join(" · ");
      text.append(el("span", "track-title", a.name), el("span", "hint small", sub));
      b.appendChild(text);
      b.addEventListener("click", () => {
        window.rememberPage();
        window.openArtist(a.artist_id);
      });
      artists.appendChild(b);
    });
    // 노래
    const tracks = $("#search-tracks");
    tracks.innerHTML = "";
    if (!result.tracks.length) tracks.appendChild(el("p", "hint small", "찾은 노래가 없어요. 영어 제목으로도 검색해 보세요."));
    result.tracks.forEach((t) => {
      const b = el("button", "track-row");
      if (t.cover) {
        const img = el("img", "track-cover");
        img.src = t.cover;
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
      }
      const text = el("span", "track-text");
      text.append(el("span", "track-title", t.title), el("span", "hint small", t.artist + (t.album ? " · " + t.album : "")));
      b.appendChild(text);
      b.addEventListener("click", () => {
        window.rememberPage();
        window.openSongById(t.track_id);
      });
      tracks.appendChild(b);
    });
  }
})();
