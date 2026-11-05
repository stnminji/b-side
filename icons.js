// =====================================================
// B-SIDE 단색 선 아이콘
// - 이모지는 기기마다 모양·색이 달라서, 같은 굵기의 선 아이콘으로 통일한다
// - 색은 글자색(currentColor)을 따라가서 버튼 상태(선택/기본)에 맞게 바뀐다
// - HTML: <i data-ic="이름"></i>  →  페이지가 열릴 때 아이콘으로 바뀜
// - JS:   el.innerHTML = ic("이름") + "글자"  (아이콘은 고정된 문자열이라 안전)
// =====================================================
(function () {
  const P = {
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    library: '<path d="M4 4v16"/><path d="M8 6v14"/><path d="M12 6v14"/><path d="M16 5.5l4 14"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 9 9" opacity=".5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.2-9.3A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 9.2 3.7C19.5 15.4 12 20 12 20z"/>',
    users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
    warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  };
  // 아이콘 하나를 SVG 문자열로 (fill: 하트처럼 채워서 그릴 때)
  window.ic = (name, fill) =>
    `<svg class="ic${fill ? " ic-fill" : ""}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
  // HTML 안의 <i data-ic="..."></i> 자리를 아이콘으로 바꾼다
  window.paintIcons = (root = document) =>
    root.querySelectorAll("i[data-ic]").forEach((i) => (i.outerHTML = window.ic(i.dataset.ic)));
  window.paintIcons();
})();
