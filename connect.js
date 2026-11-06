// =====================================================
// B-SIDE 취향으로 연결
// 순환: 노래 검색 → 감상 기록 → 같은 노래·같은 이유로 좋아하는 사람 → 그 사람에게서 새 음악 발견
//  ② AI 감상 결: 내 감상 메모·저장 곡·좋아하는 아티스트를 AI가 읽고 요약 (내 데이터만)
//  ③ 같은 노래: 내가 저장·감상한 곡을 '공개'로 저장·감상한 사람 (DB 규칙상 공개만 보임)
//     같은 이유(AI): '연결 동의'한 사람들의 감상 결 요약끼리 비교
//  ④ 발견: 그 사람이 '공개'한 곡 중 내 감상 결에 맞는 곡을 AI가 골라 줌 (목록 밖 곡은 못 만듦)
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
  let myProfile = null; // 내 감상 결 (taste_profiles)

  // 마지막으로 찾은 결과를 이 브라우저에 사용자별로 기억 (화면을 나갔다 와도 다시 보이게)
  const memKey = (kind, uid) => `gyeol:${kind}:${uid}`;
  function remember(kind, uid, data) {
    try { localStorage.setItem(memKey(kind, uid), JSON.stringify({ at: Date.now(), data })); } catch (e) {}
  }
  function recall(kind, uid) {
    try { return JSON.parse(localStorage.getItem(memKey(kind, uid)) || "null"); } catch (e) { return null; }
  }
  const when = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

  async function session() {
    const client = sb();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  // fromBack: '뒤로'로 돌아올 때는 방문 기록을 다시 쌓지 않는다
  window.openConnect = async (fromBack) => {
    if (!fromBack && window.rememberPage) window.rememberPage();
    showStep("step-connect");
    window.resetConnect();
    const s = await session();
    loadRecentNotes(); // 공개 감상은 로그인 없이도 볼 수 있음
    if (!s) {
      $("#taste-me-summary").textContent = "로그인하면 내 감상을 AI가 읽고 취향을 분석해 드려요.";
      return;
    }
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.user.id))) return;
    await loadMyTaste(s);
    const last = recall("match", s.user.id);
    if (last) renderMatches(last.data, last.at);
  };

  // 화면을 나가면(다른 화면으로 가면) 이 화면에 쓰여 있던 글자를 모두 비운다 (app.js의 showStep이 부름)
  window.resetConnect = () => {
    myProfile = null;
    ["#taste-me-summary", "#taste-me-meta", "#taste-status"].forEach((sel) => ($(sel).textContent = ""));
    $("#taste-me-tags").innerHTML = "";
    $("#match-list").innerHTML = "";
    $("#taste-consent").checked = false;
    $("#btn-match").innerHTML = ic("link") + "취향이 닮은 사람 찾기";
  };

  // ----- ② 나의 감상 결 -----
  async function loadMyTaste(s) {
    const { data } = await sb().from("taste_profiles").select("summary, tags, consent, updated_at").eq("user_id", s.user.id).limit(1);
    myProfile = data && data.length ? data[0] : null;
    paintTaste();
  }
  function paintTaste() {
    const tags = $("#taste-me-tags");
    tags.innerHTML = "";
    if (!myProfile) {
      $("#taste-me-summary").textContent = "아직 취향 분석이 없어요. 노래에 감상을 남긴 뒤 'AI로 취향 분석'을 눌러 보세요.";
      $("#taste-me-meta").textContent = "";
      $("#taste-consent").checked = false;
      $("#taste-consent").disabled = true;
      $("#btn-analyze").innerHTML = ic("sparkle") + "AI로 취향 분석";
      return;
    }
    $("#btn-analyze").innerHTML = ic("sparkle") + "분석 다시하기";
    $("#taste-me-summary").textContent = myProfile.summary;
    (myProfile.tags || []).forEach((t) => tags.appendChild(el("span", "tag", t)));
    $("#taste-me-meta").textContent = "마지막 분석: " + new Date(myProfile.updated_at).toLocaleString("ko-KR");
    $("#taste-consent").disabled = false;
    $("#taste-consent").checked = !!myProfile.consent;
  }

  $("#btn-analyze").addEventListener("click", async () => {
    const s = await session();
    if (!s) return alert("로그인 후에 쓸 수 있어요.");
    const btn = $("#btn-analyze");
    btn.disabled = true;
    $("#taste-status").textContent = "AI가 내 감상을 읽고 있어요… (10초 안팎)";
    try {
      const r = await callAI({ action: "analyze_taste", token: s.access_token });
      // 결과는 내 감상 결로 저장 (연결 동의 여부는 그대로 유지)
      const row = { summary: r.summary, tags: r.tags };
      const res = myProfile
        ? await sb().from("taste_profiles").update(row).eq("user_id", s.user.id).select("summary, tags, consent, updated_at")
        : await sb().from("taste_profiles").insert(row).select("summary, tags, consent, updated_at");
      if (res.error) throw new Error("저장하지 못했어요.");
      myProfile = res.data[0];
      paintTaste();
      const b = r.based_on;
      $("#taste-status").textContent = `✓ 분석했어요 (노래 감상 ${b.memos} · 아티스트 감상 ${b.artist_memos} · 좋아하는 아티스트 ${b.artists} 기준)`;
    } catch (e) {
      $("#taste-status").textContent = e.message || "분석하지 못했어요. 잠시 후 다시 해 주세요.";
    }
    btn.disabled = false;
  });

  $("#taste-consent").addEventListener("change", async (e) => {
    const s = await session();
    if (!s || !myProfile) return (e.target.checked = false);
    const on = e.target.checked;
    if (on && !confirm("취향 분석 요약을 다른 사용자와 AI 매칭에 사용할까요?\n(메모·저장 곡 원문은 공유되지 않아요. 언제든 끌 수 있어요)")) {
      e.target.checked = false;
      return;
    }
    const { error } = await sb().from("taste_profiles").update({ consent: on }).eq("user_id", s.user.id);
    if (error) {
      e.target.checked = !on;
      return alert("바꾸지 못했어요.");
    }
    myProfile.consent = on;
    $("#taste-status").textContent = on ? "✓ 연결을 켰어요. 취향이 닮은 사람을 찾을 수 있어요." : "연결을 껐어요. 다른 사람의 매칭에서 바로 빠져요.";
  });

  // ----- ③ 취향으로 연결된 사람: 같은 노래 · 같은 아티스트 · 같은 이유(AI) -----
  // 같은 노래·같은 아티스트: 남의 것은 '공개'로 저장·감상한 것만 (DB 규칙 + is_public 조건)
  // 같은 이유: '연결 동의'한 사람의 취향 분석 요약끼리 AI가 비교
  $("#btn-match").addEventListener("click", async () => {
    const s = await session();
    if (!s) return alert("로그인 후에 쓸 수 있어요.");
    const btn = $("#btn-match");
    const list = $("#match-list");
    btn.disabled = true;
    list.textContent = "찾고 있어요… (AI 연결은 10초 안팎)";
    const [shared, ai] = await Promise.all([findShared(s), findByReason(s)]);
    const data = { shared, ai };
    remember("match", s.user.id, data);
    renderMatches(data, Date.now());
    btn.disabled = false;
  });

  function renderMatches(data, at) {
    const list = $("#match-list");
    list.textContent = "";
    list.appendChild(el("p", "hint small last-at", `마지막으로 찾은 결과 · ${when(at)}`));
    renderGroup(list, "music", "같은 노래", data.shared.songs, "아직 내 곡을 공개로 저장·감상한 사람이 없어요.");
    renderGroup(list, "mic", "같은 아티스트", data.shared.artists, "아직 같은 아티스트를 공개로 좋아하는 사람이 없어요.");
    renderGroup(list, "sparkle", "같은 이유 (AI)", data.ai.people, data.ai.message);
    $("#btn-match").innerHTML = ic("link") + "다시 찾기";
  }

  // 같은 노래 / 같은 아티스트
  async function findShared(s) {
    const client = sb();
    const [lib, memo, amemo] = await Promise.all([
      client.from("library").select("track_id, title, artist_id, artist").eq("user_id", s.user.id).limit(300),
      client.from("song_memos").select("track_id, title, artist").eq("user_id", s.user.id).limit(300),
      client.from("artist_memos").select("name").eq("user_id", s.user.id).limit(300),
    ]);
    const mine = [...(lib.data || []), ...(memo.data || [])];
    if (!mine.length && !(amemo.data || []).length) return { songs: [], artists: [] };
    const myTracks = new Map(mine.map((x) => [x.track_id, x.title]));
    const myArtists = new Map(mine.map((x) => [norm(x.artist), x.artist]));
    (amemo.data || []).forEach((x) => myArtists.set(norm(x.name), x.name));
    // 남의 '공개' 곡 (같은 아티스트를 찾으려면 아티스트 이름으로 비교해야 해서 최근 공개 곡을 넉넉히)
    const [olib, omemo, oamemo] = await Promise.all([
      client.from("library").select("user_id, track_id, artist, profiles(nickname)").eq("is_public", true).neq("user_id", s.user.id).order("created_at", { ascending: false }).limit(500),
      client.from("song_memos").select("user_id, track_id, artist, profiles(nickname)").eq("is_public", true).neq("user_id", s.user.id).order("updated_at", { ascending: false }).limit(500),
      client.from("artist_memos").select("user_id, name, profiles(nickname)").eq("is_public", true).neq("user_id", s.user.id).order("updated_at", { ascending: false }).limit(500),
    ]);
    const songs = new Map();
    const artists = new Map();
    // 남이 '공개'로 쓴 아티스트 감상 → 같은 아티스트
    (oamemo.data || []).forEach((x) => {
      if (myArtists.has(norm(x.name))) add(artists, x.user_id, x.profiles && x.profiles.nickname, myArtists.get(norm(x.name)));
    });
    [...(olib.data || []), ...(omemo.data || [])].forEach((x) => {
      const nick = x.profiles && x.profiles.nickname;
      if (myTracks.has(x.track_id)) add(songs, x.user_id, nick, myTracks.get(x.track_id));
      else if (myArtists.has(norm(x.artist))) add(artists, x.user_id, nick, myArtists.get(norm(x.artist)));
    });
    // 같은 노래로 이미 나온 사람은 '같은 아티스트'에서 빼서 중복 없이
    songs.forEach((_, uid) => artists.delete(uid));
    const toList = (m, unit) => [...m.entries()].sort((a, b) => b[1].items.size - a[1].items.size).slice(0, 10)
      .map(([uid, p]) => ({ user_id: uid, nickname: p.nickname, badge: `${unit} ${p.items.size}`, detail: [...p.items].join(" · ") }));
    return { songs: toList(songs, "같은 노래"), artists: toList(artists, "같은 아티스트") };
  }
  function add(map, uid, nickname, item) {
    const p = map.get(uid) || { nickname, items: new Set() };
    p.items.add(item);
    map.set(uid, p);
  }
  function norm(t) {
    return String(t || "").replace(/\s|\(.*?\)/g, "").toLowerCase();
  }

  // 같은 이유 (AI)
  async function findByReason(s) {
    if (!myProfile) return { people: [], message: "먼저 위에서 'AI로 취향 분석'을 해 주세요." };
    if (!myProfile.consent) return { people: [], message: "'다른 사람과 연결하기'를 켜면 취향이 닮은 사람을 AI가 찾아줘요. (서로 동의한 사람끼리만)" };
    try {
      const r = await callAI({ action: "match_taste", token: s.access_token });
      return {
        people: r.matches.map((m) => ({ user_id: m.user_id, nickname: m.nickname, badge: `닮은 정도 ${m.score}%`, detail: m.reason, tags: m.tags })),
        message: "아직 연결에 동의한 사람 중 취향이 닮은 사람이 없어요.",
      };
    } catch (e) {
      return { people: [], message: e.message || "AI 연결을 불러오지 못했어요." };
    }
  }

  // 결과 묶음 하나 (제목 + 사람 카드들)
  function renderGroup(list, icon, title, people, empty) {
    const group = el("div", "match-group");
    const h = el("h4", "match-title");
    h.innerHTML = ic(icon);
    h.append(`${title} `, el("span", "hint small", `${people.length}명`));
    group.appendChild(h);
    if (!people.length) group.appendChild(el("p", "hint small", empty));
    people.forEach((p) => {
      const item = el("article", "record");
      const head = el("div", "neighbor-head");
      head.append(window.nickButton(p.nickname, p.user_id), el("span", "tag", p.badge));
      item.append(head, el("p", "record-summary", p.detail));
      if (p.tip) item.appendChild(tipLine(p.tip));
      if (p.tags && p.tags.length) {
        const tags = el("div", "tags");
        p.tags.forEach((t) => tags.appendChild(el("span", "tag", t)));
        item.appendChild(tags);
      }
      item.appendChild(discoverButton(p.user_id));
      group.appendChild(item);
    });
    list.appendChild(group);
  }

  // ----- 취향은 다르지만, 이것도 들어보면 어때요? (AI) -----
  // 내 취향 분석과 '다른 결'의 인디를 고르되, 공통점(다리) 하나를 함께 보여 준다
  $("#btn-contrast").addEventListener("click", async () => {
    const s = await session();
    if (!s) return alert("로그인 후에 쓸 수 있어요.");
    const btn = $("#btn-contrast");
    const list = $("#contrast-list");
    btn.disabled = true;
    list.innerHTML = "";
    list.appendChild(el("p", "hint", "AI가 평소와 다른 결의 음악을 고르고 있어요… (10~20초)"));
    try {
      const r = await callAI({ action: "contrast", token: s.access_token });
      remember("contrast", s.user.id, r);
      renderContrast(r, Date.now());
    } catch (e) {
      list.innerHTML = "";
      list.appendChild(el("p", "hint", e.message || "추천을 불러오지 못했어요. 잠시 후 다시 해 주세요."));
    }
    btn.disabled = false;
  });

  // 새로운 발견 화면 열기: 마지막 추천이 있으면 다시 보여 줌
  window.openDiscover = async () => {
    if (window.rememberPage) window.rememberPage();
    showStep("step-discover");
    $("#contrast-list").innerHTML = "";
    $("#btn-contrast").innerHTML = ic("sparkle") + "다른 결의 인디 추천받기";
    const s = await session();
    const last = s && recall("contrast", s.user.id);
    if (last) renderContrast(last.data, last.at);
  };

  function renderContrast(r, at) {
    const list = $("#contrast-list");
    list.innerHTML = "";
    list.appendChild(el("p", "hint small last-at", `마지막으로 추천받은 결과 · ${when(at)}`));
    $("#btn-contrast").innerHTML = ic("sparkle") + "다시 추천받기";
    {
      // 추천 카드는 기존 모양을 그대로 쓰고, 카드마다 '다른 점'과 '공통점'을 붙인다
      appendBands(r.bands, list, false);
      [...list.querySelectorAll(".band")].forEach((card, i) => {
        const b = r.bands[i];
        if (!b) return;
        const reason = card.querySelector(".band-reason");
        if (reason) reason.textContent = "다른 점 · " + b.reason;
        if (b.bridge) {
          const bridge = el("p", "bridge");
          bridge.innerHTML = ic("link");
          bridge.append("공통점 · " + b.bridge);
          (reason || card).after(bridge);
        }
        if (b.listen) (card.querySelector(".bridge") || reason || card).after(tipLine(b.listen));
      });
    }
  }

  // ----- 최근 공개된 감상 노트 (노래 + 아티스트, 최신순) -----
  // DB 규칙(RLS)상 공개 글만 읽히고, is_public 조건도 함께 건다
  async function loadRecentNotes() {
    const list = $("#recent-notes");
    list.textContent = "불러오는 중…";
    const client = sb();
    if (!client) return (list.textContent = "");
    const [songs, artists] = await Promise.all([
      client.from("song_memos").select("id, user_id, track_id, artist, title, cover, memo, updated_at, profiles(nickname)")
        .eq("is_public", true).order("updated_at", { ascending: false }).limit(15),
      client.from("artist_memos").select("id, user_id, artist_id, name, picture, memo, updated_at, profiles(nickname)")
        .eq("is_public", true).order("updated_at", { ascending: false }).limit(10),
    ]);
    const rows = [
      ...(songs.data || []).map((r) => ({ ...r, kind: "song" })),
      ...(artists.data || []).map((r) => ({ ...r, kind: "artist" })),
    ].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 20);
    list.textContent = "";
    if (!rows.length) return list.appendChild(el("p", "hint", "아직 공개된 감상이 없어요. 내 감상 노트를 '공개'로 저장하면 여기에 보여요."));
    const counts = await window.loadSocialCounts((songs.data || []).map((r) => r.id));
    rows.forEach((r) => {
      const item = el("article", "record note-card");
      const who = el("p", "record-who");
      who.append(window.nickButton(r.profiles && r.profiles.nickname, r.user_id), " · " + new Date(r.updated_at).toLocaleDateString("ko-KR"));
      const head = r.kind === "song" ? window.trackRow(r) : window.artistRow(r);
      item.append(who, head, el("p", "record-summary", r.memo)); // 남이 쓴 글 → textContent로만
      if (r.kind === "song") item.appendChild(window.socialBar("song_memo", r.id, counts[r.id]));
      list.appendChild(item);
    });
  }

  // "이렇게 들어보면 어때요?" 한 줄 (헤드폰 아이콘 + 제안)
  function tipLine(text, tag = "p") {
    const t = el(tag, "listen-tip");
    t.innerHTML = ic("headphones");
    t.append(text);
    return t;
  }

  // ----- ④ 그 사람에게서 새 음악 발견 (AI) -----
  function discoverButton(userId, target) {
    const wrap = el("div");
    const btn = el("button", "btn-small");
    btn.innerHTML = ic("sparkle") + "이 사람에게서 새 음악 발견";
    const out = target || el("div", "track-list");
    btn.addEventListener("click", () => runDiscover(userId, btn, out));
    wrap.append(btn, out);
    return wrap;
  }
  async function runDiscover(userId, btn, out) {
    const s = await session();
    if (!s) return alert("로그인 후에 쓸 수 있어요.");
    btn.disabled = true;
    out.textContent = "AI가 이 사람의 공개 곡 중에서 고르고 있어요…";
    try {
      const r = await callAI({ action: "discover", token: s.access_token, target_id: userId });
      out.textContent = "";
      if (!r.picks.length) out.appendChild(el("p", "hint small", "새로 추천할 공개 곡이 아직 없어요."));
      r.picks.forEach((p) => {
        const row = window.trackRow(p);
        row.querySelector(".track-text").appendChild(el("span", "pick-reason", p.reason));
        if (p.tip) row.querySelector(".track-text").appendChild(tipLine(p.tip, "span"));
        out.appendChild(row);
      });
    } catch (e) {
      out.textContent = e.message || "발견하지 못했어요.";
    }
    btn.disabled = false;
  }

  // 공개 프로필에서도 '이 사람에게서 새 음악 발견'
  $("#profile-discover").addEventListener("click", () => {
    if (window.currentProfileUser) runDiscover(window.currentProfileUser, $("#profile-discover"), $("#profile-picks"));
  });
})();
