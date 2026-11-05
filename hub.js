// =====================================================
// B-SIDE 홈 허브: 검색창 아래 '기록' · '소셜' 두 버튼
// - 기록: AI 디깅(로그인 없이 가능) · 내 서재 · 내 메모 · 추천 기록(로그인 필요)
// - 소셜: 디깅 피드(로그인 없이 구경 가능) → 취향 비교는 로그인 후
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);

  $("#hub-archive").addEventListener("click", () => showStep("step-archive"));
  // 순환의 1단계 '검색': 위쪽 검색창으로 데려간다
  $("#hub-search").addEventListener("click", () => {
    document.body.classList.add("searching"); // 홈에서 숨겨 둔 검색창을 보여 준다
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#search-q").focus();
  });
  $("#hub-social").addEventListener("click", () => window.openConnect());

  // 로그인이 필요한 메뉴는 먼저 확인하고, 안 했으면 로그인 창을 연다
  async function needLogin() {
    const sb = window.bsideSb;
    if (!sb) {
      alert("로그인 기능을 불러오지 못했어요. 새로고침해 주세요.");
      return true;
    }
    const { data } = await sb.auth.getSession();
    if (data.session) return false;
    alert("로그인하면 내 음악 창고·메모·기록을 볼 수 있어요.");
    $("#btn-open-login").click();
    return true;
  }

  document.querySelectorAll(".tile").forEach((tile) =>
    tile.addEventListener("click", async () => {
      const go = tile.dataset.go;
      if (go === "ai") return showStep("step-input"); // AI 디깅은 로그인 없이도 사용
      if (go === "taste") return window.openConnect(); // 감상 결은 '취향으로 연결'에서
      if (await needLogin()) return;
      if (window.rememberPage) window.rememberPage();
      await window.showRecords();       // '내 기록' 화면 열기 (추천 기록 목록도 불러옴)
      window.selectRecordsTab(go);      // 고른 탭으로
    })
  );
})();
