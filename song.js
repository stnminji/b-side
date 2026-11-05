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
  window.openSong = (artist, title) => artist && title && loadSong({ action: "song_info", artist, title }, { artist, title });
  // 아티스트 페이지·서재에서 누른 곡은 곡 번호로 바로 연다
  window.openSongById = (trackId) => loadSong({ action: "song_info", track_id: trackId }, null);

  async function loadSong(request, typed) {
    showStep("step-loading");
    startLoadingSteps("음악 데이터베이스에서 노래를 찾고 있어요…");
    try {
      song = await callAI(request);
    } catch (e) {
      stopLoadingSteps();
      alert(e.message || "노래를 찾지 못했어요.");
      return window.goBack ? window.goBack() : showStep("step-input");
    }
    stopLoadingSteps();
    song.query = typed || { artist: song.artist, title: song.title };
    renderSong();
    selectTab("info");
    showStep("step-song");
    loadMemo();
    loadLibraryState();
    loadOthers();
  }

  function renderSong() {
    // AI·외부 데이터는 textContent로만 넣는다 (스크립트 삽입 방지)
    const cover = $("#song-cover");
    cover.hidden = !song.cover;
    if (song.cover) cover.src = song.cover;
    $("#song-name").textContent = song.title;
    $("#song-by").textContent = song.artist + " ›";
    $("#song-source").href = song.source_link; // 출처 표시 (Deezer 이용 조건)
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
        cover: song.cover || null, isrc: song.isrc || null, memo: text, is_public: memoPublic,
      }).select("id, memo, is_public, updated_at");
    }
    $("#memo-save").disabled = false;
    if (res.error || !res.data || !res.data.length) return setStatus("저장하지 못했어요. 잠시 후 다시 해 주세요.");
    memo = res.data[0];
    loadOthers();
    setStatus("✓ 저장했어요 · " + new Date(memo.updated_at).toLocaleString("ko-KR") + (memo.is_public ? " · 🌐 공개" : " · 🔒 나만 보기"));
  });

  // ----- 내 음악 서재: 담기 / 빼기 -----
  let libraryRow = null;
  function paintLibrary() {
    const btn = $("#btn-library");
    btn.textContent = libraryRow ? "✓ 서재에 담김" : "＋ 서재에 담기";
    btn.classList.toggle("ghost", !libraryRow);
  }
  async function loadLibraryState() {
    libraryRow = null;
    paintLibrary();
    const client = sb();
    if (!client) return;
    const { data: s } = await client.auth.getSession();
    if (!s.session) return;
    const { data: rows } = await client.from("library").select("id")
      .eq("user_id", s.session.user.id).eq("track_id", song.track_id).limit(1);
    libraryRow = rows && rows.length ? rows[0] : null;
    paintLibrary();
  }
  $("#btn-library").addEventListener("click", async () => {
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) {
      alert("서재는 로그인 후에 쓸 수 있어요.");
      return $("#btn-open-login").click();
    }
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.session.user.id))) return;
    const btn = $("#btn-library");
    btn.disabled = true;
    if (libraryRow) {
      const { error } = await client.from("library").delete().eq("id", libraryRow.id);
      if (!error) libraryRow = null;
    } else {
      // 같은 곡은 DB가 (사용자, 곡 번호) 한 번만 허용 → 중복 등록 불가
      const date = /^\d{4}(-\d{2}){0,2}$/.test(song.release_date || "") ? song.release_date : null;
      const { data, error } = await client.from("library").insert({
        track_id: song.track_id, isrc: song.isrc || null, artist_id: song.artist_id || null,
        artist: song.artist.slice(0, 100), title: song.title.slice(0, 200),
        album: (song.album || "").slice(0, 200) || null, release_date: date, cover: song.cover || null,
      }).select("id");
      if (!error && data) libraryRow = data[0];
      else if (error && /duplicate|unique/i.test(error.message)) await loadLibraryState();
    }
    btn.disabled = false;
    paintLibrary();
  });

  // ----- 다른 사람들의 감상 (같은 곡의 '공개' 메모) -----
  async function loadOthers() {
    const list = $("#others-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    if (!client) return (list.textContent = "");
    const { data: s } = await client.auth.getSession();
    const myId = s.session ? s.session.user.id : null;
    const { data: rows, error } = await client.from("song_memos")
      .select("user_id, memo, updated_at, profiles(nickname)")
      .eq("track_id", song.track_id).eq("is_public", true)
      .order("updated_at", { ascending: false }).limit(20);
    list.textContent = "";
    const others = (rows || []).filter((r) => r.user_id !== myId);
    if (error || !others.length) return (list.textContent = "아직 공개된 감상이 없어요. 내 메모를 🌐 공개로 저장하면 첫 감상이 돼요.");
    others.forEach((r) => {
      const item = el("article", "record");
      const nick = (r.profiles && r.profiles.nickname) || "익명";
      item.append(
        el("p", "record-who", "@" + nick + " · " + new Date(r.updated_at).toLocaleDateString("ko-KR")),
        el("p", "record-summary", r.memo) // 남이 쓴 글 → textContent로만
      );
      list.appendChild(item);
    });
  }

  // ----- 아티스트 페이지 -----
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  let artist = null;
  // 페이지를 옮길 때마다 지금 페이지를 기억 → '뒤로'로 돌아올 수 있게 (search.js)
  const go = (fn) => { if (window.rememberPage) window.rememberPage(); fn(); };
  $("#song-by").addEventListener("click", () => song && go(() => window.openArtist(song.artist_id)));
  $("#artist-back").addEventListener("click", () => window.goBack());
  $("#song-back").addEventListener("click", () => window.goBack());

  window.openArtist = async (artistId) => {
    if (!artistId) return;
    showStep("step-loading");
    startLoadingSteps("아티스트 정보를 불러오고 있어요…");
    try {
      artist = await callAI({ action: "artist_info", artist_id: artistId });
    } catch (e) {
      stopLoadingSteps();
      alert(e.message || "아티스트 정보를 불러오지 못했어요.");
      return window.goBack ? window.goBack() : showStep("step-input");
    }
    stopLoadingSteps();
    renderArtist();
    showStep("step-artist");
  };

  function renderArtist() {
    const pic = $("#artist-picture");
    pic.hidden = !artist.picture;
    if (artist.picture) pic.src = artist.picture;
    $("#artist-name").textContent = artist.name;
    $("#artist-meta").textContent = [
      artist.name_db !== artist.name ? artist.name_db : "",
      artist.albums_count ? `앨범 ${artist.albums_count}장` : "",
      artist.fans ? `Deezer 팬 ${artist.fans.toLocaleString()}명` : "",
    ].filter(Boolean).join(" · ");
    $("#artist-source").href = artist.source_link;
    // 우리가 직접 정리한 아티스트라면 설명 표시
    $("#artist-curated").hidden = !artist.curated;
    if (artist.curated) {
      $("#artist-genre").textContent = artist.curated.genre;
      $("#artist-sound").textContent = artist.curated.sound;
      $("#artist-moods").innerHTML = "";
      artist.curated.mood.forEach((m) => $("#artist-moods").appendChild(el("span", "tag", "#" + m)));
    }
    // 노래 (누르면 곡 페이지)
    const tracks = $("#artist-tracks");
    tracks.innerHTML = "";
    if (!artist.top.length) tracks.appendChild(el("p", "hint", "노래 정보가 없어요."));
    artist.top.forEach((t) => {
      const b = el("button", "track-row");
      const text = el("span", "track-text");
      text.append(el("span", "track-title", t.title), el("span", "hint small", t.album));
      b.appendChild(text);
      b.addEventListener("click", () => go(() => window.openSongById(t.track_id)));
      tracks.appendChild(b);
    });
    // 앨범
    const albums = $("#artist-albums");
    albums.innerHTML = "";
    artist.albums.forEach((a) => {
      const card = el("div", "album");
      if (a.cover) {
        const img = el("img");
        img.src = a.cover;
        img.alt = a.title;
        img.loading = "lazy";
        card.appendChild(img);
      }
      card.append(el("span", "album-title", a.title), el("span", "hint small", (a.release_date || "").slice(0, 4)));
      albums.appendChild(card);
    });
    // 비슷한 아티스트 (음악 DB 기준, 누르면 그 아티스트 페이지)
    const rel = $("#artist-related");
    rel.innerHTML = "";
    if (!artist.related.length) rel.appendChild(el("p", "hint small", "음악 DB에 비슷한 아티스트 정보가 없어요. 아래 AI 찾기를 눌러 보세요."));
    artist.related.forEach((r) => {
      const b = el("button", "btn-small ghost", r.name);
      b.addEventListener("click", () => go(() => window.openArtist(r.artist_id)));
      rel.appendChild(b);
    });
    $("#artist-ai-list").innerHTML = "";
    $("#artist-ai").disabled = false;
  }

  // AI로 비슷한 인디 아티스트 찾기 (기존 추천 기능 재사용, 실존 검증 포함)
  $("#artist-ai").addEventListener("click", async () => {
    const btn = $("#artist-ai");
    const list = $("#artist-ai-list");
    btn.disabled = true;
    list.innerHTML = "";
    const wait = el("p", "hint", "AI가 찾고 있어요… (10초 안팎)");
    list.appendChild(wait);
    try {
      const query = `좋아하는 아티스트: ${artist.name}`;
      const result = await callAI({ action: "recommend", mode: "band", query });
      wait.remove();
      appendBands(result.bands, list, false);
      if (window.saveRecord) window.saveRecord("band", query, result);
    } catch (e) {
      wait.textContent = "찾지 못했어요. 다시 눌러 주세요.";
      btn.disabled = false;
    }
  });

  // ----- 내 기록 화면의 '내 서재' 탭 -----
  function selectRecordsTab(tab) {
    document.querySelectorAll(".records-tab").forEach((b) => {
      const on = b.dataset.rtab === tab;
      b.classList.toggle("active", on);
      b.classList.toggle("ghost", !on);
    });
    $("#library-panel").hidden = tab !== "library";
    $("#records-panel").hidden = tab !== "records";
    if (tab === "library") loadLibraryList();
  }
  document.querySelectorAll(".records-tab").forEach((b) => b.addEventListener("click", () => selectRecordsTab(b.dataset.rtab)));
  $("#btn-my-records").addEventListener("click", () => selectRecordsTab("library"));

  async function loadLibraryList() {
    const list = $("#library-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return (list.textContent = "로그인이 필요해요.");
    // DB 규칙상 남의 '공개' 서재도 읽을 수 있으므로 반드시 '내 것'만
    const { data: rows, error } = await client.from("library")
      .select("id, track_id, artist, title, album, cover, created_at")
      .eq("user_id", s.session.user.id).order("created_at", { ascending: false }).limit(200);
    list.textContent = "";
    if (error) return (list.textContent = "서재를 불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 담은 노래가 없어요. 노래 검색에서 ＋ 서재에 담기를 눌러 보세요.");
    rows.forEach((r) => {
      const b = el("button", "track-row");
      if (r.cover) {
        const img = el("img", "track-cover");
        img.src = r.cover;
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
      }
      const text = el("span", "track-text");
      text.append(el("span", "track-title", r.title), el("span", "hint small", r.artist + (r.album ? " · " + r.album : "")));
      b.appendChild(text);
      b.addEventListener("click", () => go(() => window.openSongById(r.track_id)));
      list.appendChild(b);
    });
  }
})();
