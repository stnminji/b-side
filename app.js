// =====================================================
// B-SIDE - 화면 동작 코드
// AI 기능은 서버 함수(/api/gemini)를 부른다. API 키는 서버에만 있고 여기에는 없다.
// AI 호출이 실패하면(키 없음, 사용량 초과 등) 임시 키워드 추천으로 대신 보여준다.
// =====================================================

const $ = (sel) => document.querySelector(sel);

// ----- 서버 AI 함수 호출 -----
async function callAI(payload) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "AI 요청에 실패했어요.");
  return data;
}

// 캡처 이미지를 적당한 크기(긴 변 1600px)의 JPEG로 줄여서 base64로 바꾼다 (전송 용량 줄이기)
function imageToBase64(file, maxSize = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9).split(",")[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 파일을 그대로 base64로 바꾼다 (변환할 수 없는 형식용)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 실제 AI 호출 대신 잠깐 기다렸다가 데이터를 돌려주는 함수
const fakeAI = (data, ms = 1200) => new Promise((resolve) => setTimeout(() => resolve(data), ms));

// ----- 아티스트 데이터 불러오기 (data/bands.json) -----
let ARTISTS = [];
fetch("data/bands.json")
  .then((res) => res.json())
  .then((data) => (ARTISTS = data.bands))
  .catch(() => console.warn("bands.json을 불러오지 못했어요. 로컬 서버로 실행했는지 확인하세요."));

// =====================================================
// [예비] 키워드 추천 - AI 호출이 실패했을 때만 사용
// 입력 글에서 분위기·장르 키워드를 찾아 데이터 안의 아티스트를 고른다.
// =====================================================

// "몽환적인" → "몽환", "청량함" → "청량"처럼 끝말을 떼서 비교하기 쉽게 만든다
const stem = (w) => w.replace(/\(.*?\)/g, "").trim().replace(/(적인|적|한|인|함|은|는)$/, "");

// 아티스트의 분위기 + 장르 단어 목록
function keywordsOf(a) {
  const genres = a.genre.split(/[·\/,()\s]+/);
  return [...a.mood, ...genres].map(stem).filter((w) => w.length >= 2);
}

function localRecommend(query) {
  // 1) 입력에 데이터 속 아티스트 이름이 있으면, 그 아티스트의 분위기·장르를 기준으로 삼는다
  const mentioned = ARTISTS.filter((a) => query.includes(a.name));
  let words = mentioned.flatMap(keywordsOf);

  // 2) 입력 글 자체에 있는 분위기·장르 단어도 기준에 더한다
  const allWords = [...new Set(ARTISTS.flatMap(keywordsOf))];
  words = [...new Set([...words, ...allWords.filter((w) => query.includes(w))])];

  // 3) 기준 단어와 많이 겹치는 아티스트 순서로 3팀 (입력에 나온 아티스트는 제외)
  const ranked = ARTISTS.filter((a) => !mentioned.includes(a))
    .map((a) => ({ a, hit: keywordsOf(a).filter((w) => words.includes(w)) }))
    .sort((x, y) => y.hit.length - x.hit.length || Math.random() - 0.5);
  const picks = ranked.slice(0, 3);

  const found = words.length > 0;
  return {
    summary: found
      ? "키워드가 비슷한 아티스트를 골랐어요. (임시 추천)"
      : "키워드를 못 찾아 무작위로 골랐어요. (임시 추천)",
    tags: words.slice(0, 6).map((w) => "#" + w),
    bands: picks.map(({ a, hit }) => ({
      name: a.name,
      genre: a.genre,
      image: a.image,
      reason: hit.length ? `'${[...new Set(hit)].join("', '")}' 느낌이 겹쳐요.` : a.sound,
      songs: a.songs.slice(0, 3).map((s) => ({ title: s.title, point: s.note })),
    })),
  };
}

// ----- 화면 단계 전환 -----
const STEPS = ["step-input", "step-confirm", "step-loading", "step-result", "step-records", "step-feed", "step-song"];
function showStep(id) {
  STEPS.forEach((s) => ($("#" + s).hidden = s !== id));
  // 상단 버튼 중 지금 보고 있는 화면의 버튼을 검정으로 채워서 표시
  $("#btn-feed").classList.toggle("active", id === "step-feed");
  $("#btn-my-records").classList.toggle("active", id === "step-records");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ----- 탭 (사진 / 텍스트) -----
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("#panel-capture").hidden = tab.dataset.tab !== "capture";
    $("#panel-text").hidden = tab.dataset.tab !== "text";
  });
});

// 버튼 묶음에서 하나만 선택되게 하는 공통 함수
function setupOptions(groupSel, onChange) {
  const buttons = document.querySelectorAll(`${groupSel} .option`);
  buttons.forEach((btn) =>
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      onChange(btn);
    })
  );
}

// =====================================================
// 사진으로 추천받기 (아티스트 리스트 / 노래 리스트)
// =====================================================
const CAPTURE_KINDS = {
  artists: {
    dropTitle: "<strong>아티스트 목록</strong> 캡처를 올려주세요",
    confirmTitle: "이 아티스트들이 맞나요?",
    placeholder: "아티스트 이름",
    queryLabel: "좋아하는 아티스트 목록",
  },
  songs: {
    dropTitle: "<strong>노래 목록</strong> 캡처를 올려주세요",
    confirmTitle: "이 노래들이 맞나요?",
    placeholder: "아티스트 - 노래 제목",
    queryLabel: "좋아하는 노래 목록",
  },
};
let captureKind = "artists";

setupOptions("#capture-options", (btn) => {
  captureKind = btn.dataset.kind;
  $("#drop-title").innerHTML = CAPTURE_KINDS[captureKind].dropTitle;
});

const fileInput = $("#file-input");
const dropzone = $("#dropzone");
let currentFile = null;

function setImage(file) {
  if (!file || !(file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name))) return;
  currentFile = file;
  $("#preview").src = URL.createObjectURL(file);
  $("#preview").onerror = () => { $("#preview").hidden = true; $("#drop-empty").hidden = false; $("#drop-title").textContent = file.name; };
  $("#preview").hidden = false;
  $("#drop-empty").hidden = true;
  $("#btn-capture").disabled = false;
}

fileInput.addEventListener("change", () => setImage(fileInput.files[0]));
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  setImage(e.dataTransfer.files[0]);
});

$("#btn-capture").addEventListener("click", async () => {
  showStep("step-loading");
  $("#loading-text").textContent = "캡처를 읽고 있어요…";
  let items = [];
  try {
    let image, mime = "image/jpeg";
    try {
      image = await imageToBase64(currentFile); // 크기를 줄인 JPEG
    } catch {
      // 브라우저가 못 여는 형식(아이폰 HEIC 등)은 원본 그대로 보낸다 (Gemini는 HEIC도 읽음)
      if (currentFile.size > 4 * 1024 * 1024) throw new Error("사진이 너무 커요. 4MB 이하로 올려주세요.");
      image = await fileToBase64(currentFile);
      mime = currentFile.type || "image/heic";
    }
    items = (await callAI({ action: "extract", kind: captureKind, image, mime })).items;
    if (items.length === 0) alert("캡처에서 목록을 찾지 못했어요. 직접 입력해 주세요.");
  } catch (e) {
    console.warn(e);
    alert(`AI가 캡처를 읽지 못했어요. 직접 입력해 주세요.\n(${e.message})`);
  }
  $("#confirm-title").textContent = CAPTURE_KINDS[captureKind].confirmTitle;
  renderItems(items.length ? items : [""]);
  showStep("step-confirm");
});

// ----- 읽은 목록 확인/수정 -----
function addItemRow(value = "") {
  const li = document.createElement("li");
  li.innerHTML = `<input type="text" /><button class="remove" title="삭제">✕</button>`;
  const input = li.querySelector("input");
  input.value = value;
  input.placeholder = CAPTURE_KINDS[captureKind].placeholder;
  li.querySelector(".remove").addEventListener("click", () => li.remove());
  $("#song-list").appendChild(li);
}

function renderItems(items) {
  $("#song-list").innerHTML = "";
  items.forEach((s) => addItemRow(s));
}

$("#btn-add-song").addEventListener("click", () => addItemRow());

$("#btn-confirm").addEventListener("click", () => {
  const items = [...document.querySelectorAll("#song-list input")].map((i) => i.value.trim()).filter(Boolean);
  if (items.length === 0) return alert("하나 이상 입력해 주세요.");
  recommend("photo_" + captureKind, `${CAPTURE_KINDS[captureKind].queryLabel}: ${items.join(", ")}`);
});

// =====================================================
// 텍스트로 추천받기 (버튼을 누르면 입력 방식이 바뀜)
// =====================================================
let textMode = "mood";

setupOptions("#text-options", (btn) => {
  textMode = btn.dataset.mode;
  document.querySelectorAll(".mode-panel").forEach((p) => (p.hidden = p.dataset.mode !== textMode));
  $("#btn-text").textContent = textMode === "song" ? "노래 찾기" : "추천받기";
  updateTextButton();
});

// 분위기 버튼: 눌렀다 뗐다(여러 개 선택)
document.querySelectorAll("#mood-chips .chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    chip.classList.toggle("on");
    updateTextButton();
  })
);

// 예시 버튼: 누르면 입력칸에 채워짐
document.querySelectorAll(".chip.fill").forEach((chip) =>
  chip.addEventListener("click", () => {
    $("#" + chip.dataset.target).value = chip.textContent;
    updateTextButton();
  })
);

document.querySelectorAll("#panel-text input, #panel-text textarea").forEach((el) =>
  el.addEventListener("input", updateTextButton)
);

// 모드별로 AI에게 보낼 문장 만들기 (비어 있으면 "" → 버튼 비활성화)
function buildTextQuery() {
  const v = (id) => $("#" + id).value.trim();
  switch (textMode) {
    case "mood": {
      const moods = [...document.querySelectorAll("#mood-chips .chip.on")].map((c) => c.textContent);
      return moods.length ? `듣고 싶은 분위기: ${moods.join(", ")}` : "";
    }
    case "song": // 노래 검색: 아티스트와 제목이 둘 다 있어야 버튼이 켜짐
      return v("song-title") && v("song-artist") ? `좋아하는 노래: ${v("song-artist")} - ${v("song-title")}` : "";
    case "feel":
      return v("feel-input") ? `원하는 느낌: ${v("feel-input")}` : "";
    case "free":
      return v("free-input");
  }
  return "";
}

function updateTextButton() {
  $("#btn-text").disabled = !buildTextQuery();
}

// '노래 검색'은 곡 페이지로, 나머지는 바로 추천으로
$("#btn-text").addEventListener("click", () => {
  if (textMode === "song" && window.openSong) return window.openSong($("#song-artist").value.trim(), $("#song-title").value.trim());
  recommend(textMode, buildTextQuery());
});

// 엔터를 누르면 바로 검색 (자유 설명 칸은 Shift+Enter로 줄바꿈)
// e.isComposing: 한글 조합 중 엔터는 무시해야 두 번 검색되지 않는다
document.querySelectorAll("#panel-text input, #panel-text textarea").forEach((el) =>
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.shiftKey) return;
    e.preventDefault();
    if (!$("#btn-text").disabled) $("#btn-text").click();
  })
);

// 캡처 목록 확인 화면에서도 엔터 = 추천받기
$("#song-list").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  $("#btn-confirm").click();
});

// =====================================================
// 추천 받기 & 결과 표시
// =====================================================
const RESULT_TITLES = {
  band: "비슷한 결의 아티스트",
  photo_artists: "비슷한 결의 아티스트",
  song: "비슷한 결의 노래",
  photo_songs: "이어 듣기 좋은 아티스트",
};

// '더 찾아보기'에 쓰려고 마지막 검색 조건과 보여준 아티스트를 기억해 둔다
let lastSearch = null;

// 기다리는 동안 지금 무엇을 하는지 차례로 보여준다 (오래 걸려도 멈춘 것처럼 보이지 않게)
let loadingTimers = [];
function startLoadingSteps(first) {
  stopLoadingSteps();
  $("#loading-text").textContent = first;
  [
    [5000, "취향에 맞는 아티스트를 고르는 중…"],
    [12000, "실제로 있는 아티스트·곡인지 확인하는 중…"],
    [22000, "AI 서버가 붐벼서 조금 더 걸리고 있어요…"],
  ].forEach(([ms, text]) => loadingTimers.push(setTimeout(() => ($("#loading-text").textContent = text), ms)));
}
function stopLoadingSteps() {
  loadingTimers.forEach(clearTimeout);
  loadingTimers = [];
}

async function recommend(mode, query) {
  lastSearch = { mode, query, shown: [] };
  showStep("step-loading");
  startLoadingSteps("결을 분석하고 있어요…");
  $(".result-title").textContent = RESULT_TITLES[mode] || "이런 아티스트는 어때요?";
  let result;
  try {
    result = await callAI({ action: "recommend", mode, query });
  } catch (e) {
    // AI가 안 될 때도 데모가 멈추지 않도록 임시 추천으로 대신한다
    console.warn("AI 추천 실패, 임시 추천 사용:", e.message);
    result = { ...(await fakeAI(localRecommend(query), 300)), fallback: true };
  }
  stopLoadingSteps();
  renderResult(result);
  showStep("step-result");
  // 로그인한 사용자라면 '내 기록'에 저장하고, 저장됐는지 화면에 알려준다 (auth.js가 정의)
  $("#save-status").textContent = "";
  if (window.saveRecord) {
    const status = await window.saveRecord(mode, query, result);
    $("#save-status").textContent =
      status === "saved" ? "✓ 내 기록에 저장했어요" :
      status === "guest" ? "로그인하면 이 결과가 내 기록에 저장돼요" :
      status === "no-nickname" ? "닉네임을 정하면 내 기록에 저장돼요" :
      "내 기록에 저장하지 못했어요. 잠시 후 다시 해 주세요.";
  }
}

function renderResult(result) {
  $("#save-status").textContent = "";
  $("#compare-box").hidden = true; // 취향 비교 결과 상자는 feed.js가 필요할 때만 켠다
  $("#btn-more").hidden = false;
  $("#taste-summary").textContent = result.summary;
  $("#taste-tags").innerHTML = result.tags.map((t) => `<span class="tag">${t}</span>`).join("");

  $("#result-list").innerHTML = "";
  appendBands(result.bands);
}

// 더 찾아보기: 이미 보여준 아티스트는 빼고 3팀을 더 받아 아래에 붙인다
$("#btn-more").addEventListener("click", async () => {
  const btn = $("#btn-more");
  btn.disabled = true;
  btn.textContent = "찾는 중…";
  try {
    const result = await callAI({ action: "recommend", ...lastSearch, exclude: lastSearch.shown });
    appendBands(result.bands);
  } catch (e) {
    alert("더 찾지 못했어요. 잠시 후 다시 눌러주세요.");
  }
  btn.disabled = false;
  btn.textContent = "더 찾아보기";
});

// target: 카드를 넣을 곳 (기본은 추천 결과 화면, 노래 페이지의 탭에서도 같이 씀)
function appendBands(bands, target = $("#result-list"), track = true) {
  bands.forEach((b, i) => {
    if (track && lastSearch) lastSearch.shown.push(b.name);
    const card = document.createElement("article");
    card.className = "band";
    card.style.animationDelay = `${i * 0.1}s`;
    card.innerHTML = `
      <div class="band-head">
        <div class="avatar-slot"></div>
        <div>
          <span class="band-name"></span>
          <span class="band-genre"></span>
        </div>
      </div>
      <p class="band-reason"></p>
      <ol class="songs"></ol>
    `;
    card.querySelector(".avatar-slot").replaceWith(avatar(b));
    // textContent로 넣어서 AI가 만든 글에 이상한 코드가 섞여도 안전하게 표시
    card.querySelector(".band-name").textContent = b.name;
    card.querySelector(".band-genre").textContent = b.genre;
    card.querySelector(".band-reason").textContent = b.reason;
    // 우리 데이터 밖에서 AI가 새로 찾은 아티스트 표시 (Deezer로 실존 확인됨)
    if (b.discovered) {
      const badge = document.createElement("span");
      badge.className = "discovered";
      badge.textContent = "AI 발견";
      badge.title = "AI가 새로 찾고, 음악 데이터베이스에서 실제로 있는지 확인한 아티스트";
      card.querySelector(".band-name").after(badge);
    }

    // 밴드에 연결된 노래 목록
    b.songs.forEach((s, j) => card.querySelector(".songs").appendChild(songRow(b.name, s, j === 0)));
    target.appendChild(card);
  });
}

// 아티스트 사진 (없거나 못 불러오면 이름 첫 글자로 대신)
function avatar(b) {
  const initial = () => {
    const div = document.createElement("div");
    div.className = "avatar";
    div.textContent = b.name[0];
    return div;
  };
  if (!b.image) return initial();
  const img = document.createElement("img");
  img.className = "avatar";
  img.alt = b.name;
  img.src = b.image;
  img.onerror = () => img.replaceWith(initial());
  return img;
}

// 노래 한 줄: 제목 + 한 줄 설명 + 듣기 링크
function songRow(bandName, song, isFirst) {
  const li = document.createElement("li");
  if (isFirst) li.classList.add("first");
  li.innerHTML = `
    <div class="song-info">
      <span class="song-title"></span>
      <span class="song-point"></span>
    </div>
    <a class="song-play" target="_blank" rel="noopener" title="유튜브에서 듣기">▶</a>
  `;
  li.querySelector(".song-title").textContent = song.title;
  if (song.hidden) li.classList.add("hidden-gem"); // 숨은 곡 표시
  li.querySelector(".song-point").textContent = song.point;
  // 실제 영상 주소를 AI가 지어내지 않도록, "밴드명 + 곡명" 검색 결과로 연결한다
  li.querySelector(".song-play").href =
    "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${bandName} ${song.title}`);
  return li;
}

// ----- 처음으로 -----
document.querySelectorAll(".btn-restart, .go-home").forEach((btn) => btn.addEventListener("click", () => showStep("step-input")));
