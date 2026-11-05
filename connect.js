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

  async function session() {
    const client = sb();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  window.openConnect = async () => {
    if (window.rememberPage) window.rememberPage();
    showStep("step-connect");
    const s = await session();
    $("#match-list").innerHTML = "";
    if (!s) {
      $("#taste-me-summary").textContent = "로그인하면 내 감상을 AI가 읽고 취향을 분석해 드려요.";
      $("#taste-me-tags").innerHTML = "";
      $("#taste-me-meta").textContent = "";
      $("#same-song-list").textContent = "로그인 후 노래를 저장하거나 감상을 남기면, 같은 노래를 좋아하는 사람을 찾아드려요.";
      return;
    }
    if (window.bsideEnsureProfile && !(await window.bsideEnsureProfile(s.user.id))) return;
    await loadMyTaste(s);
    loadSameSong(s);
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
      return;
    }
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
      $("#taste-status").textContent = `✓ 분석했어요 (감상 메모 ${b.memos} · 저장 곡 ${b.saved} · 좋아하는 아티스트 ${b.artists}개 기준)`;
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

  // ----- ③ 같은 노래를 좋아하는 사람 (공개 저장·감상 기준) -----
  async function loadSameSong(s) {
    const list = $("#same-song-list");
    list.textContent = "불러오는 중…";
    const client = sb();
    const [lib, memo] = await Promise.all([
      client.from("library").select("track_id, title").eq("user_id", s.user.id).limit(300),
      client.from("song_memos").select("track_id, title").eq("user_id", s.user.id).limit(300),
    ]);
    const mine = new Map();
    [...(lib.data || []), ...(memo.data || [])].forEach((x) => mine.set(x.track_id, x.title));
    if (!mine.size) return (list.textContent = "노래를 검색해서 저장하거나 감상을 남기면, 같은 노래를 좋아하는 사람이 보여요.");
    const ids = [...mine.keys()].slice(0, 200);
    // DB 규칙상 남의 것은 '공개'만 읽힌다 (is_public 조건도 함께)
    const [olib, omemo] = await Promise.all([
      client.from("library").select("user_id, track_id, profiles(nickname)").in("track_id", ids).eq("is_public", true).neq("user_id", s.user.id).limit(300),
      client.from("song_memos").select("user_id, track_id, profiles(nickname)").in("track_id", ids).eq("is_public", true).neq("user_id", s.user.id).limit(300),
    ]);
    const people = new Map();
    [...(olib.data || []), ...(omemo.data || [])].forEach((x) => {
      const p = people.get(x.user_id) || { nickname: x.profiles && x.profiles.nickname, songs: new Set() };
      p.songs.add(mine.get(x.track_id));
      people.set(x.user_id, p);
    });
    list.textContent = "";
    if (!people.size) return list.appendChild(el("p", "hint", "아직 같은 노래를 공개한 사람이 없어요. 아래 'AI로 같은 이유 찾기'로 넓혀 보세요."));
    [...people.entries()].sort((a, b) => b[1].songs.size - a[1].songs.size).slice(0, 10).forEach(([uid, p]) => {
      const item = el("article", "record");
      const head = el("div", "neighbor-head");
      head.append(window.nickButton(p.nickname, uid), el("span", "tag", `같은 노래 ${p.songs.size}곡`));
      item.append(head, el("p", "record-artists", [...p.songs].join(" · ")), discoverButton(uid));
      list.appendChild(item);
    });
  }

  // ----- ③ 같은 이유로 연결 (AI) -----
  $("#btn-match").addEventListener("click", async () => {
    const s = await session();
    if (!s) return alert("로그인 후에 쓸 수 있어요.");
    const list = $("#match-list");
    const btn = $("#btn-match");
    btn.disabled = true;
    list.textContent = "AI가 취향이 닮은 사람을 찾고 있어요…";
    try {
      const r = await callAI({ action: "match_taste", token: s.access_token });
      list.textContent = "";
      if (!r.matches.length) list.appendChild(el("p", "hint", "아직 연결에 동의한 사람 중 취향이 닮은 사람이 없어요."));
      r.matches.forEach((m) => {
        const item = el("article", "record");
        const head = el("div", "neighbor-head");
        head.append(window.nickButton(m.nickname, m.user_id), el("span", "tag", `닮은 정도 ${m.score}%`));
        item.append(head, el("p", "record-summary", m.reason));
        const tags = el("div", "tags");
        m.tags.forEach((t) => tags.appendChild(el("span", "tag", t)));
        item.append(tags, discoverButton(m.user_id));
        list.appendChild(item);
      });
    } catch (e) {
      list.textContent = e.message || "찾지 못했어요. 잠시 후 다시 해 주세요.";
    }
    btn.disabled = false;
  });

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
