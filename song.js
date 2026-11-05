// =====================================================
// B-SIDE 노래 검색 페이지
// - 곡 정보: 음악 DB(Deezer)에서 실제 곡을 찾은 뒤에만 보여준다 (없는 곡은 지어내지 않음)
// - 탭: 곡 정보 / 비슷한 아티스트 / 비슷한 노래 (탭을 처음 누를 때 AI 추천을 불러옴)
// - 내 메모: 노래마다 하나, 기본 '나만 보기'. DB 규칙(RLS)상 내 메모만 쓰고·고치고·지울 수 있다
//   (나중에 소셜 기능에서 '공개' 메모만 다른 사람에게 보이게 할 예정)
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);
  let song = null;      // 지금 보고 있는 곡 정보
  let memo = null;      // 이 곡에 저장된 내 메모 (없으면 null)
  let memoPublic = false;
  const loaded = {};    // 탭별 추천을 이미 불러왔는지

  // ----- 노래 열기 -----
  window.openSong = async (artist, title) => {
    if (!artist || !title) return;
    showStep("step-loading");
    startLoadingSteps("음악 데이터베이스에서 노래를 찾고 있어요…");
    try {
      song = await callAI({ action: "song_info", artist, title });
    } catch (e) {
      stopLoadingSteps();
      alert(e.message || "노래를 찾지 못했어요.");
      return showStep("step-input");
    }
    stopLoadingSteps();
    song.query = { artist, title };
    renderSong();
    selectTab("info");
    showStep("step-song");
    loadMemo();
  };

  function renderSong() {
    // AI·외부 데이터는 textContent로만 넣는다 (스크립트 삽입 방지)
    const cover = $("#song-cover");
    cover.hidden = !song.cover;
    if (song.cover) cover.src = song.cover;
    $("#song-name").textContent = song.title;
    $("#song-by").textContent = song.artist;
    $("#song-album").textContent = [song.album, song.release_date].filter(Boolean).join(" · ");
    // 입력한 제목과 DB 제목이 다르면 알려준다 (예: '입춘' → 영어 제목으로 등록된 경우)
    const typed = song.query.title.replace(/\s/g, "").toLowerCase();
    const same = song.title.replace(/\s/g, "").toLowerCase().startsWith(typed);
    $("#song-matched").hidden = same;
    $("#song-matched").textContent = `'${song.query.title}'(으)로 검색해서 찾은 곡이에요. 음악 DB에는 '${song.title}'(으)로 등록돼 있어요.`;
    $("#song-genre").textContent = song.genre || "장르 정보 없음";
    $("#song-intro").textContent = song.intro
      ? song.intro + (song.based_on === "artist" ? " (아티스트 스타일 기준 AI 소개)" : " (AI 소개)")
      : "AI 소개를 불러오지 못했어요.";
    $("#song-moment").textContent = song.moment ? "🎧 " + song.moment : "";
    $("#song-tags").innerHTML = "";
    song.tags.forEach((t) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = t;
      $("#song-tags").appendChild(span);
    });
    $("#song-play").href = "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${song.artist} ${song.title}`);
    // 탭 추천은 곡이 바뀌면 다시 불러오게 비운다
    document.querySelectorAll('.song-panel[data-tab="band"] .result-list, .song-panel[data-tab="song"] .result-list')
      .forEach((el) => (el.innerHTML = ""));
    loaded.band = loaded.song = false;
  }

  // ----- 탭 -----
  function selectTab(tab) {
    document.querySelectorAll(".song-tab").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      b.classList.toggle("ghost", !on);
    });
    document.querySelectorAll(".song-panel").forEach((p) => (p.hidden = p.dataset.tab !== tab));
    if (tab !== "info" && !loaded[tab]) loadRecs(tab);
  }
  document.querySelectorAll(".song-tab").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

  async function loadRecs(tab) {
    loaded[tab] = true;
    const list = document.querySelector(`.song-panel[data-tab="${tab}"] .result-list`);
    list.innerHTML = "";
    const wait = document.createElement("p");
    wait.className = "hint";
    wait.textContent = "AI가 찾고 있어요… (10초 안팎)";
    list.appendChild(wait);
    const query = tab === "band" ? `좋아하는 아티스트: ${song.artist}` : `좋아하는 노래: ${song.artist} - ${song.title}`;
    try {
      const result = await callAI({ action: "recommend", mode: tab, query });
      wait.remove();
      appendBands(result.bands, list, false);
      if (window.saveRecord) window.saveRecord(tab, query, result); // 로그인했다면 내 기록에도 저장
    } catch (e) {
      loaded[tab] = false; // 다시 누르면 재시도
      wait.textContent = "추천을 불러오지 못했어요. 탭을 다시 눌러 주세요.";
    }
  }

  // ----- 내 메모 -----
  const sb = () => window.bsideSb;

  function paintVisibility() {
    const btn = $("#memo-visibility");
    btn.textContent = memoPublic ? "🌐 공개" : "🔒 나만 보기";
    btn.classList.toggle("ghost", !memoPublic);
    btn.title = memoPublic ? "다른 사람도 닉네임과 함께 볼 수 있어요" : "나만 볼 수 있어요";
  }
  function setStatus(text) {
    $("#memo-status").textContent = text;
  }
  $("#memo-text").addEventListener("input", () => {
    $("#memo-count").textContent = `${$("#memo-text").value.length} / 1000`;
  });
  $("#memo-visibility").addEventListener("click", () => {
    if (!memoPublic && !confirm("이 메모를 공개할까요? 저장하면 다른 사람이 닉네임과 함께 볼 수 있어요. (이메일은 보이지 않아요)")) return;
    memoPublic = !memoPublic;
    paintVisibility();
    setStatus("저장을 눌러야 바뀐 공개 설정이 적용돼요.");
  });

  async function loadMemo() {
    memo = null;
    memoPublic = false;
    $("#memo-text").value = "";
    $("#memo-count").textContent = "0 / 1000";
    paintVisibility();
    setStatus("");
    const client = sb();
    if (!client) return setStatus("로그인 기능을 불러오지 못했어요.");
    const { data: s } = await client.auth.getSession();
    if (!s.session) {
      $("#memo-text").disabled = true;
      $("#memo-save").disabled = true;
      return setStatus("로그인하면 이 노래에 나만의 메모를 남길 수 있어요.");
    }
    $("#memo-text").disabled = false;
    $("#memo-save").disabled = false;
    // DB 규칙상 남의 '공개' 메모도 읽을 수 있으므로 반드시 '내 것'으로 거른다
    const { data: rows } = await client
      .from("song_memos").select("id, memo, is_public, updated_at")
      .eq("user_id", s.session.user.id).eq("track_id", song.track_id).limit(1);
    if (rows && rows.length) {
      memo = rows[0];
      memoPublic = memo.is_public;
      $("#memo-text").value = memo.memo;
      $("#memo-count").textContent = `${memo.memo.length} / 1000`;
      paintVisibility();
      setStatus("마지막 저장: " + new Date(memo.updated_at).toLocaleString("ko-KR"));
    }
  }

  $("#memo-save").addEventListener("click", async () => {
    const client = sb();
    const text = $("#memo-text").value.trim();
    if (!text) return setStatus("메모 내용을 적어 주세요.");
    if (text.length > 1000) return setStatus("메모는 1000자까지 쓸 수 있어요.");
    const { data: s } = await client.auth.getSession();
    if (!s.session) return setStatus("로그인이 필요해요.");
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.session.user.id)))
      return setStatus("닉네임을 정해야 메모를 저장할 수 있어요.");
    $("#memo-save").disabled = true;
    setStatus("저장 중…");
    let res;
    if (memo) {
      // 이미 있는 메모: 내용과 공개 여부만 고칠 수 있음 (DB 규칙)
      res = await client.from("song_memos").update({ memo: text, is_public: memoPublic })
        .eq("id", memo.id).select("id, memo, is_public, updated_at");
    } else {
      res = await client.from("song_memos").insert({
        track_id: song.track_id, artist: song.artist.slice(0, 100), title: song.title.slice(0, 200),
        cover: song.cover || null, memo: text, is_public: memoPublic,
      }).select("id, memo, is_public, updated_at");
    }
    $("#memo-save").disabled = false;
    if (res.error || !res.data || !res.data.length) return setStatus("저장하지 못했어요. 잠시 후 다시 해 주세요.");
    memo = res.data[0];
    setStatus("✓ 저장했어요 · " + new Date(memo.updated_at).toLocaleString("ko-KR") + (memo.is_public ? " · 🌐 공개" : " · 🔒 나만 보기"));
  });
})();
