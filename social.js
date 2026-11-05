// =====================================================
// B-SIDE 소셜 공통 부품
// - 좋아요 · 댓글 바 (공개 글에만 달 수 있음 → DB 규칙이 강제)
// - 공개 프로필: 그 사람의 '공개' 서재 · 노래 감상 · 자유 메모 · 추천 기록 + 나와 겹치는 아티스트
// - 같은 음악을 좋아하는 사람: 이 아티스트/곡을 '공개 서재'에 담은 사람
// - 취향 이웃: 내 서재와 공개 서재가 겹치는 사람 (DB 함수 similar_users)
// 다른 사람이 쓴 글은 모두 textContent로만 넣는다 (스크립트 삽입 방지)
// =====================================================
(function () {
  const $ = (sel) => document.querySelector(sel);
  const sb = () => window.bsideSb;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  async function me() {
    const client = sb();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session ? data.session.user.id : null;
  }
  function askLogin(msg) {
    alert(msg || "로그인 후에 쓸 수 있어요.");
    $("#btn-open-login").click();
  }
  window.bsideMe = me;

  // 닉네임 버튼 (누르면 공개 프로필)
  window.nickButton = (nickname, userId) => {
    const b = el("button", "nick-btn", "@" + (nickname || "익명"));
    b.title = "공개 프로필 보기";
    b.addEventListener("click", () => {
      if (window.rememberPage) window.rememberPage();
      window.openProfile(userId);
    });
    return b;
  };

  // ----- 좋아요 · 댓글 바 -----
  // 여러 글의 좋아요·댓글 수를 한 번에 불러온다 (글마다 따로 부르면 느려서)
  window.loadSocialCounts = async (ids) => {
    const client = sb();
    const counts = {};
    ids.forEach((id) => (counts[id] = { likes: 0, comments: 0, liked: false }));
    if (!client || !ids.length) return counts;
    const my = await me();
    const [likes, comments] = await Promise.all([
      client.from("likes").select("target_id, user_id").in("target_id", ids),
      client.from("comments").select("target_id").in("target_id", ids),
    ]);
    (likes.data || []).forEach((l) => {
      counts[l.target_id].likes++;
      if (l.user_id === my) counts[l.target_id].liked = true;
    });
    (comments.data || []).forEach((c) => counts[c.target_id].comments++);
    return counts;
  };

  window.socialBar = (type, id, count) => {
    const wrap = el("div", "social");
    const row = el("div", "social-row");
    const likeBtn = el("button", "social-btn");
    const commentBtn = el("button", "social-btn");
    let state = { ...(count || { likes: 0, comments: 0, liked: false }) };
    const paint = () => {
      likeBtn.innerHTML = ic("heart", state.liked) + state.likes;
      likeBtn.classList.toggle("on", state.liked);
      commentBtn.innerHTML = ic("chat") + state.comments;
    };
    paint();
    row.append(likeBtn, commentBtn);
    const panel = el("div", "comments");
    panel.hidden = true;
    wrap.append(row, panel);

    likeBtn.addEventListener("click", async () => {
      const my = await me();
      if (!my) return askLogin("좋아요는 로그인 후에 누를 수 있어요.");
      if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(my))) return;
      likeBtn.disabled = true;
      const client = sb();
      const res = state.liked
        ? await client.from("likes").delete().eq("user_id", my).eq("target_type", type).eq("target_id", id)
        : await client.from("likes").insert({ target_type: type, target_id: id });
      likeBtn.disabled = false;
      if (res.error && !/duplicate|unique/i.test(res.error.message)) return;
      state.liked = !state.liked;
      state.likes += state.liked ? 1 : -1;
      paint();
    });

    commentBtn.addEventListener("click", async () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await loadComments();
    });

    async function loadComments() {
      panel.textContent = "불러오는 중…";
      const client = sb();
      const my = await me();
      const { data: rows } = await client.from("comments")
        .select("id, user_id, body, created_at, profiles(nickname)")
        .eq("target_type", type).eq("target_id", id).order("created_at").limit(100);
      panel.textContent = "";
      (rows || []).forEach((c) => {
        const item = el("div", "comment");
        item.append(window.nickButton(c.profiles && c.profiles.nickname, c.user_id), el("span", "comment-body", c.body));
        if (c.user_id === my) {
          const del = el("button", "link-btn hint small", "삭제");
          del.addEventListener("click", async () => {
            const { error } = await client.from("comments").delete().eq("id", c.id);
            if (!error) {
              item.remove();
              state.comments--;
              paint();
            }
          });
          item.appendChild(del);
        }
        panel.appendChild(item);
      });
      if (!rows || !rows.length) panel.appendChild(el("p", "hint small", "첫 댓글을 남겨 보세요."));
      // 댓글 입력
      const form = el("form", "comment-form");
      const input = el("input", "field");
      input.maxLength = 300;
      input.placeholder = my ? "댓글 달기 (300자)" : "로그인하면 댓글을 달 수 있어요";
      input.disabled = !my;
      const send = el("button", "btn-small", "등록");
      send.type = "submit";
      send.disabled = !my;
      form.append(input, send);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(my))) return;
        send.disabled = true;
        const { error } = await client.from("comments").insert({ target_type: type, target_id: id, body: body.slice(0, 300) });
        send.disabled = false;
        if (error) return alert("댓글을 달지 못했어요.");
        state.comments++;
        paint();
        await loadComments();
      });
      panel.appendChild(form);
    }
    return wrap;
  };

  // ----- 사람 목록 (같은 아티스트/곡을 공개 서재에 담은 사람) -----
  window.renderPeople = async (container, column, value, label, table = "library") => {
    container.textContent = "불러오는 중…";
    const client = sb();
    if (!client) return (container.textContent = "");
    const my = await me();
    // RLS: 남의 서재는 '공개'만 읽힌다 → 비공개로 담은 사람은 여기 나올 수 없음
    const { data: rows } = await client.from(table)
      .select("user_id, profiles(nickname)").eq(column, value).eq("is_public", true).limit(200);
    container.textContent = "";
    const seen = new Map();
    (rows || []).forEach((r) => r.user_id !== my && seen.set(r.user_id, r.profiles && r.profiles.nickname));
    if (!seen.size) return container.appendChild(el("p", "hint small", label));
    seen.forEach((nick, uid) => container.appendChild(window.nickButton(nick, uid)));
  };

  // ----- 취향 이웃 (소셜 → 피드 탭) -----
  window.loadNeighbors = async (container) => {
    container.textContent = "불러오는 중…";
    const my = await me();
    if (!my) {
      container.textContent = "";
      container.appendChild(el("p", "hint", "로그인하고 노래를 음악 창고에 담으면, 취향이 겹치는 사람을 찾아드려요."));
      return;
    }
    const { data: rows, error } = await sb().rpc("similar_users", { lim: 20 });
    container.textContent = "";
    if (error) return container.appendChild(el("p", "hint", "불러오지 못했어요."));
    if (!rows.length) {
      container.appendChild(el("p", "hint", "아직 취향이 겹치는 사람이 없어요. 노래를 음악 창고에 더 담아 보세요. (다른 사람의 '공개' 음악 창고와 비교해요)"));
      return;
    }
    rows.forEach((r) => {
      const item = el("article", "record");
      const head = el("div", "neighbor-head");
      head.append(window.nickButton(r.nickname, r.user_id), el("span", "tag", `겹치는 아티스트 ${r.shared}팀`));
      item.append(head, el("p", "record-artists", r.artists.join(" · ")));
      container.appendChild(item);
    });
  };

  // ----- 공개 프로필 -----
  let profileUser = null;
  window.openProfile = async (userId) => {
    if (!userId) return;
    profileUser = userId;
    window.currentProfileUser = userId; // '이 사람에게서 새 음악 발견'에서 사용 (connect.js)
    showStep("step-profile");
    $("#profile-picks").innerHTML = "";
    const viewer = await me();
    $("#profile-discover").hidden = !viewer || viewer === userId; // 로그인했고 남의 프로필일 때만
    const client = sb();
    $("#profile-name").textContent = "불러오는 중…";
    $("#profile-stats").textContent = "";
    $("#profile-common").hidden = true;
    const { data: p } = await client.from("profiles").select("nickname, created_at").eq("id", userId).limit(1);
    if (!p || !p.length) return ($("#profile-name").textContent = "찾을 수 없는 사용자예요.");
    $("#profile-name").textContent = "@" + p[0].nickname;
    // 공개된 것만 센다 (내 프로필을 볼 때도 '남에게 보이는 모습' 그대로)
    const pub = (table) => client.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_public", true);
    const [memo, amemo] = await Promise.all([pub("song_memos"), pub("artist_memos")]);
    $("#profile-stats").textContent = `공개 감상 노트: 노래 ${memo.count || 0} · 아티스트 ${amemo.count || 0}`;
    // 나와 겹치는 아티스트
    const my = await me();
    if (my && my !== userId) {
      const [mine, theirs] = await Promise.all([
        client.from("library").select("artist_id, artist").eq("user_id", my),
        client.from("library").select("artist_id, artist").eq("user_id", userId).eq("is_public", true),
      ]);
      const mySet = new Set((mine.data || []).map((x) => x.artist_id));
      const common = [...new Set((theirs.data || []).filter((x) => x.artist_id && mySet.has(x.artist_id)).map((x) => x.artist))];
      if (common.length) {
        $("#profile-common").hidden = false;
        $("#profile-common").textContent = `나와 겹치는 아티스트: ${common.join(" · ")}`;
        $("#profile-common").insertAdjacentHTML("afterbegin", ic("users"));
      }
    }
    selectProfileTab("memos"); // 음악 창고는 숨김 → 노래 감상이 첫 탭
  };

  function selectProfileTab(tab) {
    document.querySelectorAll(".profile-tab").forEach((b) => {
      const on = b.dataset.ptab === tab;
      b.classList.toggle("active", on);
      b.classList.toggle("ghost", !on);
    });
    loadProfileTab(tab);
  }
  document.querySelectorAll(".profile-tab").forEach((b) => b.addEventListener("click", () => selectProfileTab(b.dataset.ptab)));
  $("#profile-back").addEventListener("click", () => window.goBack());

  async function loadProfileTab(tab) {
    const list = $("#profile-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const base = (table, cols) => client.from(table).select(cols).eq("user_id", profileUser).eq("is_public", true);
    let rows = [];
    if (tab === "library") rows = (await base("library", "track_id, artist, title, album, cover").order("created_at", { ascending: false }).limit(100)).data || [];
    if (tab === "memos") rows = (await base("song_memos", "id, track_id, artist, title, cover, memo, updated_at").order("updated_at", { ascending: false }).limit(50)).data || [];
    if (tab === "notes") rows = (await base("notes", "id, body, created_at").order("created_at", { ascending: false }).limit(50)).data || [];
    if (tab === "artist_memos") rows = (await base("artist_memos", "id, artist_id, name, picture, memo, updated_at").order("updated_at", { ascending: false }).limit(50)).data || [];
    if (tab === "records") rows = (await base("records", "id, query, summary, bands, created_at").order("created_at", { ascending: false }).limit(50)).data || [];
    list.textContent = "";
    if (!rows.length) return list.appendChild(el("p", "hint", "아직 공개한 내용이 없어요."));
    const counts = tab === "library" || tab === "artist_memos" ? {} : await window.loadSocialCounts(rows.map((r) => r.id));
    rows.forEach((r) => {
      if (tab === "library") return list.appendChild(trackRow(r));
      if (tab === "artist_memos") {
        const item = el("article", "record");
        item.append(artistRow(r), el("p", "record-summary", r.memo));
        return list.appendChild(item);
      }
      const item = el("article", "record");
      if (tab === "memos") item.append(trackRow(r), el("p", "record-summary", r.memo), window.socialBar("song_memo", r.id, counts[r.id]));
      if (tab === "notes") item.append(el("p", "hint small", new Date(r.created_at).toLocaleDateString("ko-KR")), el("p", "record-summary", r.body), window.socialBar("note", r.id, counts[r.id]));
      if (tab === "records") item.append(el("p", "record-query", r.query), el("p", "record-summary", r.summary || ""),
        el("p", "record-artists", (r.bands || []).map((b) => b.name).join(" · ")), window.socialBar("record", r.id, counts[r.id]));
      list.appendChild(item);
    });
  }

  // 노래 한 줄 (누르면 노래 페이지)
  function trackRow(r) {
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
    b.addEventListener("click", () => {
      if (window.rememberPage) window.rememberPage();
      window.openSongById(r.track_id);
    });
    return b;
  }
  window.trackRow = trackRow;

  // 아티스트 한 줄 (누르면 아티스트 페이지)
  function artistRow(r) {
    const b = el("button", "track-row");
    if (r.picture) {
      const img = el("img", "track-cover round");
      img.src = r.picture;
      img.alt = "";
      img.loading = "lazy";
      b.appendChild(img);
    }
    const text = el("span", "track-text");
    text.append(el("span", "track-title", r.name));
    b.appendChild(text);
    b.addEventListener("click", () => {
      if (window.rememberPage) window.rememberPage();
      window.openArtist(r.artist_id);
    });
    return b;
  }
  window.artistRow = artistRow;
})();
