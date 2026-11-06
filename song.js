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
  // preview: 목록에 이미 있던 정보(제목·아티스트·앨범·커버). 있으면 기다리지 않고 바로 페이지를 띄운다
  window.openSongById = (trackId, preview) => loadSong({ action: "song_info", track_id: trackId }, null, preview);

  async function loadSong(request, typed, preview) {
    if (preview && preview.title) {
      song = { track_id: request.track_id, title: preview.title, artist: preview.artist || "", album: preview.album || "",
               cover: preview.cover || "", release_date: "", genre: "", source_link: "#", query: { artist: preview.artist || "", title: preview.title } };
      renderSong();
      $("#song-genre").textContent = "곡 정보를 불러오는 중…";
      selectTab("info");
      showStep("step-song");
    } else {
      showStep("step-loading");
      startLoadingSteps("음악을 찾고 있어요…", []);
    }
    try {
      song = await callAI(request);
    } catch (e) {
      stopLoadingSteps();
      alert(e.message || "노래를 찾지 못했어요.");
      return window.goBack ? window.goBack() : showStep("step-home");
    }
    stopLoadingSteps();
    song.query = typed || { artist: song.artist, title: song.title };
    renderSong();
    selectTab("info");
    showStep("step-song");
    loadMemo();
    loadLibraryState();
    loadOthers();
    window.renderPeople($("#song-people"), "track_id", song.track_id, "아직 이 곡을 공개 음악 창고에 담은 사람이 없어요.");
    loadIntro(song.track_id);
  }

  // AI 소개는 따로 불러온다 (가장 오래 걸리는 부분이라, 곡 정보 페이지를 먼저 띄우기 위해)
  async function loadIntro(trackId) {
    $("#song-intro").textContent = "AI가 이 노래를 소개하고 있어요…";
    $("#song-moment").textContent = "";
    $("#song-tags").innerHTML = "";
    try {
      const ai = await callAI({ action: "song_intro", track_id: trackId });
      if (!song || song.track_id !== trackId) return; // 그새 다른 곡으로 넘어갔으면 무시
      Object.assign(song, ai);
      paintIntro();
    } catch (e) {
      if (song && song.track_id === trackId) $("#song-intro").textContent = "AI 소개를 불러오지 못했어요.";
    }
  }
  function paintIntro() {
    $("#song-genre").textContent = song.genre || "장르 정보 없음";
    $("#song-intro").textContent = song.intro
      ? song.intro + (song.based_on === "artist" ? " (아티스트 스타일 기준 AI 소개)" : " (AI 소개)")
      : "AI 소개를 불러오지 못했어요.";
    $("#song-moment").textContent = song.moment || "";
    if (song.moment) $("#song-moment").insertAdjacentHTML("afterbegin", ic("headphones"));
    $("#song-tags").innerHTML = "";
    (song.tags || []).forEach((t) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = t;
      $("#song-tags").appendChild(span);
    });
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
    btn.innerHTML = memoPublic ? ic("globe") + "공개" : ic("lock") + "나만 보기";
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
    setStatus("✓ 저장했어요 · " + new Date(memo.updated_at).toLocaleString("ko-KR") + (memo.is_public ? " · 공개" : " · 나만 보기"));
  });

  // ----- 내 음악 서재: 담기 / 빼기 -----
  let libraryRow = null;
  function paintLibrary() {
    const btn = $("#btn-library");
    btn.textContent = libraryRow ? "✓ 창고에 담김" : "＋ 창고에 담기";
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
      alert("음악 창고는 로그인 후에 쓸 수 있어요.");
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
      .select("id, user_id, memo, updated_at, profiles(nickname)")
      .eq("track_id", song.track_id).eq("is_public", true)
      .order("updated_at", { ascending: false }).limit(20);
    list.textContent = "";
    const others = (rows || []).filter((r) => r.user_id !== myId);
    if (error || !others.length) return (list.textContent = "아직 공개된 감상이 없어요. 내 메모를 '공개'로 저장하면 첫 감상이 돼요.");
    const counts = await window.loadSocialCounts(others.map((r) => r.id));
    others.forEach((r) => {
      const item = el("article", "record");
      const who = el("p", "record-who");
      who.append(window.nickButton(r.profiles && r.profiles.nickname, r.user_id), " · " + new Date(r.updated_at).toLocaleDateString("ko-KR"));
      item.append(who, el("p", "record-summary", r.memo), window.socialBar("song_memo", r.id, counts[r.id])); // 남이 쓴 글 → textContent로만
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
    startLoadingSteps("음악을 찾고 있어요…", []);
    try {
      artist = await callAI({ action: "artist_info", artist_id: artistId });
    } catch (e) {
      stopLoadingSteps();
      alert(e.message || "아티스트 정보를 불러오지 못했어요.");
      return window.goBack ? window.goBack() : showStep("step-home");
    }
    stopLoadingSteps();
    artist.bsideFans = await countFans(artist.artist_id);
    renderArtist();
    showStep("step-artist");
  };

  function renderArtist() {
    const pic = $("#artist-picture");
    pic.hidden = !artist.picture;
    if (artist.picture) pic.src = artist.picture;
    $("#artist-name").textContent = artist.name;
    // 팬 수는 B-SIDE에서 '공개'로 ♡한 사람 수만. 아직 없으면 '-' (외부 숫자를 B-SIDE 팬처럼 보이게 하지 않음)
    renderArtistMeta();
    $("#artist-source").href = artist.source_link;
    // 우리가 직접 정리한 아티스트라면 설명 표시
    $("#artist-curated").hidden = !artist.curated;
    if (artist.curated) {
      $("#artist-genre").textContent = artist.curated.genre;
      $("#artist-sound").textContent = artist.curated.sound;
      $("#artist-moods").innerHTML = "";
      artist.curated.mood.forEach((m) => $("#artist-moods").appendChild(el("span", "tag", "#" + m)));
    }
    // 대표곡 (직접 정리한 아티스트는 한국어 원제 그대로, 누르면 노래 페이지)
    const feat = $("#artist-featured");
    feat.innerHTML = "";
    (artist.featured || []).forEach((t, i) => {
      const b = el("button", "track-row featured-row");
      const text = el("span", "track-text");
      text.append(el("span", "track-title", t.title), el("span", "hint small", t.note || ""));
      b.append(el("span", "featured-no", String(i + 1)), text);
      b.addEventListener("click", () => go(() => (t.track_id ? window.openSongById(t.track_id) : window.openSong(artist.name, t.title))));
      feat.appendChild(b);
    });
    // 노래 (누르면 곡 페이지)
    const tracks = $("#artist-tracks");
    tracks.innerHTML = "";
    if (!artist.top.length) tracks.appendChild(el("p", "hint", "노래 정보가 없어요."));
    artist.top.forEach((t) => {
      const b = el("button", "track-row");
      const text = el("span", "track-text");
      text.append(el("span", "track-title", t.title), el("span", "hint small", t.album));
      b.appendChild(text);
      b.addEventListener("click", () => go(() => window.openSongById(t.track_id, { ...t, artist: artist.name })));
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
    window.renderPeople($("#artist-people"), "artist_id", artist.artist_id, "아직 이 아티스트의 노래를 공개 음악 창고에 담은 사람이 없어요.");
    loadFavorite();
    loadArtistMemo();
    loadArtistOthers();
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
    $("#memos-panel").hidden = tab !== "memos";
    $("#records-panel").hidden = tab !== "records";
    $("#notes-panel").hidden = tab !== "notes";
    $("#artists-panel").hidden = tab !== "artists";
    if (tab === "artists") loadFavList();
    if (tab === "library") loadLibraryList();
    if (tab === "notes") loadNoteList();
    if (tab === "memos") loadMemoList();
  }
  document.querySelectorAll(".records-tab").forEach((b) => b.addEventListener("click", () => selectRecordsTab(b.dataset.rtab)));
  window.selectRecordsTab = selectRecordsTab; // 홈의 '기록'에서 사용 (hub.js)

  async function loadLibraryList() {
    const list = $("#library-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return (list.textContent = "로그인이 필요해요.");
    // DB 규칙상 남의 '공개' 서재도 읽을 수 있으므로 반드시 '내 것'만
    const { data: rows, error } = await client.from("library")
      .select("id, track_id, artist, title, album, cover, is_public, created_at")
      .eq("user_id", s.session.user.id).order("created_at", { ascending: false }).limit(200);
    list.textContent = "";
    if (error) return (list.textContent = "음악 창고를 불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 담은 노래가 없어요. 노래 검색에서 ＋ 창고에 담기를 눌러 보세요.");
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
      // 공개로 바꾸면 '같은 노래를 좋아하는 사람'에 내가 보이고, 다른 사람이 나에게서 새 음악을 발견할 수 있어요
      const vis = el("button", "btn-small vis-btn" + (r.is_public ? "" : " ghost"));
      const paintVis = () => {
        vis.innerHTML = r.is_public ? ic("globe") + "공개" : ic("lock") + "나만";
        vis.classList.toggle("ghost", !r.is_public);
      };
      paintVis();
      vis.addEventListener("click", async () => {
        if (!r.is_public && !confirm("이 곡을 공개할까요? 같은 노래를 좋아하는 사람에게 내 닉네임이 보여요.")) return;
        const { error: e } = await client.from("library").update({ is_public: !r.is_public }).eq("id", r.id);
        if (e) return alert("바꾸지 못했어요.");
        r.is_public = !r.is_public;
        paintVis();
      });
      const row = el("div", "lib-row");
      row.append(b, vis);
      list.appendChild(row);
    });
  }

  // ----- 내 기록 화면의 '내 메모' 탭 -----
  async function loadMemoList() {
    const list = $("#memos-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return (list.textContent = "로그인이 필요해요.");
    // DB 규칙상 남의 '공개' 감상도 읽을 수 있으므로 반드시 '내 것'만
    const { data: rows, error } = await client.from("song_memos")
      .select("id, track_id, artist, title, cover, memo, is_public, updated_at")
      .eq("user_id", s.session.user.id).order("updated_at", { ascending: false }).limit(200);
    list.textContent = "";
    if (error) return (list.textContent = "감상을 불러오지 못했어요.");
    const empty = () => (list.textContent = "아직 남긴 감상이 없어요. 노래를 검색해서 '내 감상 노트'를 남겨 보세요.");
    if (!rows.length) return empty();
    rows.forEach((r) => {
      const head = window.trackRow(r); // 누르면 노래 페이지
      list.appendChild(memoCard("song_memos", r, head, () => !list.children.length && empty()));
    });
  }

  // ----- 저장소 감상 카드: 수정 · 공개 전환 · 삭제 -----
  // table: song_memos 또는 artist_memos. DB 규칙상 '내 것'만 고치고 지울 수 있다
  function memoCard(table, r, headerRow, onDeleted) {
    const card = el("article", "record note-card");
    const body = el("p", "record-summary", r.memo || "");
    const meta = el("p", "hint small");
    const paintMeta = () => (meta.textContent = (r.is_public ? "공개" : "나만 보기") + " · " + new Date(r.updated_at).toLocaleString("ko-KR"));
    paintMeta();
    const actions = el("div", "record-actions");
    const edit = el("button", "btn-small ghost");
    edit.innerHTML = ic("pen") + "수정";
    const vis = el("button", "btn-small ghost");
    const paintVis = () => (vis.innerHTML = r.is_public ? ic("lock") + "나만 보기로" : ic("globe") + "공개로");
    paintVis();
    const del = el("button", "btn-small ghost danger", "삭제");
    actions.append(edit, vis, del);
    card.append(headerRow, body, meta, actions);

    // 수정: 그 자리에서 글쓰기 칸을 열고 저장/취소
    edit.addEventListener("click", () => {
      if (card.querySelector("textarea")) return;
      const box = el("div", "edit-box");
      const ta = el("textarea");
      ta.maxLength = 1000;
      ta.rows = 4;
      ta.value = r.memo;
      const row = el("div", "record-actions");
      const save = el("button", "btn-small", "저장");
      const cancel = el("button", "btn-small ghost", "취소");
      const count = el("span", "hint small", `${ta.value.length} / 1000`);
      ta.addEventListener("input", () => (count.textContent = `${ta.value.length} / 1000`));
      row.append(save, cancel, count);
      box.append(ta, row);
      body.hidden = true;
      actions.hidden = true;
      card.insertBefore(box, meta);
      ta.focus();
      const close = () => {
        box.remove();
        body.hidden = false;
        actions.hidden = false;
      };
      cancel.addEventListener("click", close);
      save.addEventListener("click", async () => {
        const text = ta.value.trim();
        if (!text) return alert("내용을 적어 주세요. 지우려면 '삭제'를 눌러 주세요.");
        save.disabled = true;
        const { data, error } = await sb().from(table).update({ memo: text.slice(0, 1000) }).eq("id", r.id).select("memo, updated_at");
        save.disabled = false;
        if (error || !data || !data.length) return alert("저장하지 못했어요.");
        Object.assign(r, data[0]);
        body.textContent = r.memo;
        paintMeta();
        close();
      });
    });

    // 공개 / 나만 보기 전환
    vis.addEventListener("click", async () => {
      if (!r.is_public && !confirm("이 감상을 공개할까요? 다른 사람이 닉네임과 함께 볼 수 있어요. (이메일은 보이지 않아요)")) return;
      const { data, error } = await sb().from(table).update({ is_public: !r.is_public }).eq("id", r.id).select("is_public, updated_at");
      if (error || !data || !data.length) return alert("바꾸지 못했어요.");
      Object.assign(r, data[0]);
      paintMeta();
      paintVis();
    });

    // 삭제 (공개였다면 달린 좋아요·댓글도 DB가 함께 지움)
    del.addEventListener("click", async () => {
      if (!confirm("이 감상을 삭제할까요? 되돌릴 수 없어요.")) return;
      const { error } = await sb().from(table).delete().eq("id", r.id);
      if (error) return alert("삭제하지 못했어요.");
      card.remove();
      if (onDeleted) onDeleted();
    });
    return card;
  }

  // ----- 내 기록 화면의 '자유 메모' 탭 (쓰기 + 목록) -----
  let notePublic = false;
  function paintNoteVisibility() {
    const btn = $("#note-visibility");
    btn.innerHTML = notePublic ? ic("globe") + "공개" : ic("lock") + "나만 보기";
    btn.classList.toggle("ghost", !notePublic);
  }
  $("#note-text").addEventListener("input", () => ($("#note-count").textContent = `${$("#note-text").value.length} / 1000`));
  $("#note-visibility").addEventListener("click", () => {
    if (!notePublic && !confirm("이 메모를 공개할까요? 다른 사람이 닉네임과 함께 볼 수 있어요.")) return;
    notePublic = !notePublic;
    paintNoteVisibility();
  });
  $("#note-save").addEventListener("click", async () => {
    const body = $("#note-text").value.trim();
    if (!body) return;
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return alert("로그인이 필요해요.");
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.session.user.id))) return;
    $("#note-save").disabled = true;
    const { error } = await client.from("notes").insert({ body: body.slice(0, 1000), is_public: notePublic });
    $("#note-save").disabled = false;
    if (error) return alert("저장하지 못했어요.");
    $("#note-text").value = "";
    $("#note-count").textContent = "0 / 1000";
    notePublic = false;
    paintNoteVisibility();
    loadNoteList();
  });

  async function loadNoteList() {
    const list = $("#notes-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return (list.textContent = "로그인이 필요해요.");
    // 남의 '공개' 메모도 읽히므로 반드시 '내 것'만
    const { data: rows, error } = await client.from("notes").select("id, body, is_public, created_at")
      .eq("user_id", s.session.user.id).order("created_at", { ascending: false }).limit(200);
    list.textContent = "";
    if (error) return (list.textContent = "불러오지 못했어요.");
    if (!rows.length) return (list.textContent = "아직 자유 메모가 없어요. 위에 첫 기록을 남겨 보세요.");
    const counts = await window.loadSocialCounts(rows.map((r) => r.id));
    rows.forEach((r) => {
      const item = el("article", "record");
      const vis = el("button", "btn-small" + (r.is_public ? "" : " ghost"));
      vis.innerHTML = r.is_public ? ic("globe") + "공개" : ic("lock") + "비공개";
      vis.addEventListener("click", async () => {
        if (!r.is_public && !confirm("이 메모를 공개할까요?")) return;
        const { error: e } = await client.from("notes").update({ is_public: !r.is_public }).eq("id", r.id);
        if (!e) loadNoteList();
      });
      const del = el("button", "btn-small ghost", "삭제");
      del.addEventListener("click", async () => {
        if (!confirm("이 메모를 지울까요? 달린 좋아요·댓글도 함께 지워져요.")) return;
        const { error: e } = await client.from("notes").delete().eq("id", r.id);
        if (!e) item.remove();
      });
      const actions = el("div", "record-actions");
      actions.append(vis, del);
      item.append(el("p", "hint small", new Date(r.created_at).toLocaleString("ko-KR")), el("p", "record-summary", r.body), actions);
      if (r.is_public) item.appendChild(window.socialBar("note", r.id, counts[r.id]));
      list.appendChild(item);
    });
  }

  // ----- 좋아하는 아티스트 (♡) -----
  // B-SIDE 팬 수 = 이 아티스트에 ♡ 누른 사람 수. DB 함수가 '숫자'만 돌려준다 (누가 눌렀는지는 안 보임)
  async function countFans(artistId) {
    const client = sb();
    if (!client) return 0;
    const { data, error } = await client.rpc("artist_fan_count", { aid: artistId });
    return error ? 0 : data || 0;
  }
  let favRow = null;
  function paintFav() {
    const heart = $("#btn-fav");
    heart.innerHTML = favRow ? ic("heart", true) + "좋아함" : ic("heart") + "좋아요";
    heart.classList.toggle("ghost", !favRow);
    heart.classList.toggle("fav-on", !!favRow);
  }
  async function loadFavorite() {
    favRow = null;
    paintFav();
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return;
    const { data: rows } = await client.from("favorite_artists").select("id, is_public")
      .eq("user_id", s.session.user.id).eq("artist_id", artist.artist_id).limit(1);
    favRow = rows && rows.length ? rows[0] : null;
    paintFav();
  }
  async function refreshFans() {
    artist.bsideFans = await countFans(artist.artist_id);
    renderArtistMeta();
  }
  $("#btn-fav").addEventListener("click", async () => {
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) {
      alert("좋아요는 로그인 후에 누를 수 있어요.");
      return $("#btn-open-login").click();
    }
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.session.user.id))) return;
    const btn = $("#btn-fav");
    btn.disabled = true;
    if (favRow) {
      const { error } = await client.from("favorite_artists").delete().eq("id", favRow.id);
      if (!error) favRow = null;
    } else {
      // 기본 비공개로 저장 (같은 아티스트는 DB가 한 번만 허용)
      const { data, error } = await client.from("favorite_artists")
        .insert({ artist_id: artist.artist_id, name: artist.name.slice(0, 100), picture: artist.picture || null })
        .select("id, is_public");
      if (!error && data) favRow = data[0];
      else if (error && /duplicate|unique/i.test(error.message)) await loadFavorite();
      else if (error) alert("좋아요를 저장하지 못했어요.");
    }
    btn.disabled = false;
    paintFav();
    refreshFans();
  });
  // 아티스트 정보 줄 다시 그리기 (팬 수가 바뀌었을 때)
  function renderArtistMeta() {
    $("#artist-meta").textContent = [
      artist.name_db !== artist.name ? artist.name_db : "",
      artist.albums_count ? `앨범 ${artist.albums_count}장` : "",
      `결 팬 ${artist.bsideFans ? artist.bsideFans.toLocaleString() + "명" : "-"}`,
    ].filter(Boolean).join(" · ");
  }

  // ----- 기록 → 좋아하는 아티스트 목록 -----
  async function loadFavList() {
    const list = $("#fav-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const { data: s } = await client.auth.getSession();
    if (!s.session) return (list.textContent = "로그인이 필요해요.");
    // 남의 '공개' 글도 읽히므로 반드시 '내 것'만
    const [favs, memos] = await Promise.all([
      client.from("favorite_artists").select("artist_id, name, picture, created_at").eq("user_id", s.session.user.id).limit(300),
      client.from("artist_memos").select("id, artist_id, name, picture, memo, is_public, updated_at").eq("user_id", s.session.user.id).limit(300),
    ]);
    // 같은 아티스트는 한 줄로 (♡ + 감상)
    const byId = new Map();
    (favs.data || []).forEach((f) => byId.set(f.artist_id, { ...f, liked: true, when: f.created_at }));
    (memos.data || []).forEach((m) => byId.set(m.artist_id, { ...(byId.get(m.artist_id) || {}), ...m, when: m.updated_at }));
    const rows = [...byId.values()].sort((x, y) => String(y.when).localeCompare(String(x.when)));
    list.textContent = "";
    if (!rows.length) return (list.textContent = "아직 아티스트 감상이 없어요. 아티스트 페이지에서 감상을 남기거나 하트를 눌러 보세요.");
    rows.forEach((r) => {
      const head = window.artistRow(r); // 누르면 아티스트 페이지
      let card;
      if (r.memo) {
        card = memoCard("artist_memos", r, head, () => (r.liked ? loadFavList() : null));
      } else {
        // 감상 없이 ♡만 한 아티스트 → 원하면 여기서 바로 감상을 쓸 수 있게 (기록은 선택)
        card = el("article", "record note-card");
        const hint = el("p", "hint small", "감상은 선택이에요. 남기고 싶을 때 써 보세요.");
        card.append(head, hint);
        const write = el("button", "btn-small ghost");
        write.innerHTML = ic("pen") + "감상 쓰기";
        write.addEventListener("click", () => {
          if (card.querySelector("textarea")) return;
          const box = el("div", "edit-box");
          const ta = el("textarea");
          ta.maxLength = 1000;
          ta.rows = 3;
          ta.placeholder = "이 아티스트의 어떤 점이 좋은지, 처음 알게 된 순간…";
          const row = el("div", "record-actions");
          const save = el("button", "btn-small", "저장");
          const cancel = el("button", "btn-small ghost", "취소");
          row.append(save, cancel);
          box.append(ta, row);
          card.insertBefore(box, hint.nextSibling);
          ta.focus();
          cancel.addEventListener("click", () => box.remove());
          save.addEventListener("click", async () => {
            const text = ta.value.trim();
            if (!text) return alert("감상을 적어 주세요.");
            save.disabled = true;
            // 기본은 나만 보기로 저장 (공개는 저장 후 '공개로' 버튼)
            const { error } = await sb().from("artist_memos").insert({
              artist_id: r.artist_id, name: r.name.slice(0, 100), picture: r.picture || null, memo: text.slice(0, 1000),
            });
            save.disabled = false;
            if (error) return alert("저장하지 못했어요." + (/relation|does not exist|schema cache/i.test(error.message) ? " (아티스트 감상 기능 준비 중)" : ""));
            loadFavList();
          });
        });
        const actions = el("div", "record-actions");
        actions.appendChild(write);
        card.appendChild(actions);
      }
      if (r.liked) {
        const unlike = el("button", "btn-small ghost");
        unlike.innerHTML = ic("heart", true) + "좋아요 취소";
        unlike.addEventListener("click", async () => {
          if (!confirm(`${r.name} 좋아요를 취소할까요?`)) return;
          const { error } = await sb().from("favorite_artists").delete().eq("user_id", s.session.user.id).eq("artist_id", r.artist_id);
          if (error) return alert("취소하지 못했어요.");
          loadFavList();
        });
        const row = card.querySelector(".record-actions") || card.appendChild(el("div", "record-actions"));
        row.appendChild(unlike);
      }
      list.appendChild(card);
    });
  }

  // ----- 아티스트 페이지: 내 감상 노트 (기본 나만 보기) -----
  let amemo = null;
  let amemoPublic = false;
  function paintAmemoVis() {
    const btn = $("#amemo-visibility");
    btn.innerHTML = amemoPublic ? ic("globe") + "공개" : ic("lock") + "나만 보기";
    btn.classList.toggle("ghost", !amemoPublic);
  }
  $("#amemo-text").addEventListener("input", () => ($("#amemo-count").textContent = `${$("#amemo-text").value.length} / 1000`));
  $("#amemo-visibility").addEventListener("click", () => {
    if (!amemoPublic && !confirm("이 감상을 공개할까요? 저장하면 다른 사람이 닉네임과 함께 볼 수 있어요.")) return;
    amemoPublic = !amemoPublic;
    paintAmemoVis();
    $("#amemo-status").textContent = "저장을 눌러야 바뀐 공개 설정이 적용돼요.";
  });

  async function loadArtistMemo() {
    amemo = null;
    amemoPublic = false;
    $("#amemo-text").value = "";
    $("#amemo-count").textContent = "0 / 1000";
    $("#amemo-status").textContent = "";
    paintAmemoVis();
    const { data: s } = await sb().auth.getSession();
    $("#amemo-text").disabled = !s.session;
    $("#amemo-save").disabled = !s.session;
    if (!s.session) return ($("#amemo-status").textContent = "로그인하면 이 아티스트에 대한 나만의 감상을 남길 수 있어요.");
    const { data: rows } = await sb().from("artist_memos").select("id, memo, is_public, updated_at")
      .eq("user_id", s.session.user.id).eq("artist_id", artist.artist_id).limit(1);
    if (rows && rows.length) {
      amemo = rows[0];
      amemoPublic = amemo.is_public;
      $("#amemo-text").value = amemo.memo;
      $("#amemo-count").textContent = `${amemo.memo.length} / 1000`;
      paintAmemoVis();
      $("#amemo-status").textContent = "마지막 저장: " + new Date(amemo.updated_at).toLocaleString("ko-KR");
    }
  }

  $("#amemo-save").addEventListener("click", async () => {
    const text = $("#amemo-text").value.trim();
    if (!text) return ($("#amemo-status").textContent = "감상을 적어 주세요.");
    const { data: s } = await sb().auth.getSession();
    if (!s.session) return;
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.session.user.id))) return;
    $("#amemo-save").disabled = true;
    $("#amemo-status").textContent = "저장 중…";
    const cols = "id, memo, is_public, updated_at";
    const res = amemo
      ? await sb().from("artist_memos").update({ memo: text.slice(0, 1000), is_public: amemoPublic }).eq("id", amemo.id).select(cols)
      : await sb().from("artist_memos").insert({
          artist_id: artist.artist_id, name: artist.name.slice(0, 100), picture: artist.picture || null,
          memo: text.slice(0, 1000), is_public: amemoPublic,
        }).select(cols);
    $("#amemo-save").disabled = false;
    if (res.error || !res.data || !res.data.length) return ($("#amemo-status").textContent = "저장하지 못했어요. 잠시 후 다시 해 주세요.");
    amemo = res.data[0];
    $("#amemo-status").textContent = "✓ 저장했어요 · " + new Date(amemo.updated_at).toLocaleString("ko-KR") + (amemo.is_public ? " · 공개" : " · 나만 보기");
    loadArtistOthers();
  });

  // 같은 아티스트에 대해 다른 사람들이 '공개'한 감상
  async function loadArtistOthers() {
    const list = $("#artist-others");
    list.textContent = "불러오는 중…";
    const { data: s } = await sb().auth.getSession();
    const my = s.session ? s.session.user.id : null;
    const { data: rows } = await sb().from("artist_memos").select("user_id, memo, updated_at, profiles(nickname)")
      .eq("artist_id", artist.artist_id).eq("is_public", true).order("updated_at", { ascending: false }).limit(20);
    const others = (rows || []).filter((r) => r.user_id !== my);
    list.textContent = "";
    if (!others.length) return (list.textContent = "아직 공개된 감상이 없어요. 내 감상을 '공개'로 저장하면 첫 감상이 돼요.");
    others.forEach((r) => {
      const item = el("article", "record");
      const who = el("p", "record-who");
      who.append(window.nickButton(r.profiles && r.profiles.nickname, r.user_id), " · " + new Date(r.updated_at).toLocaleDateString("ko-KR"));
      item.append(who, el("p", "record-summary", r.memo)); // 남이 쓴 글 → textContent로만
      list.appendChild(item);
    });
  }
})();
