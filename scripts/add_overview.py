"""
발표 PPT에 '기획 한눈에' 슬라이드 1장 추가 (문제 → 대상 → 기능 → 전공 연결)
실행:  python scripts/add_overview.py 입력.pptx 출력.pptx
- 문제 정의(2장) 바로 뒤, 3장 자리에 넣고 뒤쪽 쪽번호를 하나씩 민다
- 사용자가 고친 다른 슬라이드는 건드리지 않는다
"""
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

BG = RGBColor(0xF4, 0xED, 0xE2)
CARD = RGBColor(0xFF, 0xFB, 0xF2)
TERRA = RGBColor(0xC2, 0x65, 0x3A)
INK = RGBColor(0x2B, 0x24, 0x20)
SUB = RGBColor(0x8A, 0x7E, 0x72)
LINE = RGBColor(0xE4, 0xD9, 0xC6)
FONT = "맑은 고딕"

# (번호, 소제목, 내용 줄들) — 마지막 칸(전공)은 어두운 카드로 강조
COLS = [
    ("1", "어떤 문제를", [
        "재생 수 기반 추천이라 듣는 사람이 적은 인디는 잘 안 뜬다",
        "왜 추천했는지 설명이 없다",
        "같은 인디를 듣는 사람을 만나 감상을 나눌 곳이 없다",
    ]),
    ("2", "누구를 위해", [
        "인디를 좋아하지만 주변에 같이 듣는 사람이 없는 리스너",
        "알고리즘 말고 새 인디를 직접 '디깅'하고 싶은 사람",
        "멜론·스포티파이 등 쓰는 앱이 달라도 누구나",
    ]),
    ("3", "이런 기능으로", [
        "① 검색: 영어로 등록된 곡도 한국어 원제로",
        "② 감상 노트: 기본 비공개, 원할 때만 공개",
        "③ AI 취향 분석 → 같은 노래·아티스트·이유로 연결",
        "④ AI가 다른 결의 인디 + 공통점 추천",
    ]),
    ("4", "IT 전공과 연결", [
        "웹 풀스택: 화면(HTML·JS) + 서버 함수 + Vercel 배포",
        "DB 설계·권한: 비공개 기록과 소유권을 DB 규칙으로 보호",
        "API 연동·데이터 정제: 음악 DB 두 곳을 음원 코드로 대조",
        "생성형 AI: 프롬프트 설계 + 실제로 있는 곡인지 검증",
        "보안: 키는 서버에만, 요청 제한, 비밀번호 암호화",
    ]),
]


def tb(slide, x, y, w, h, runs, align=PP_ALIGN.LEFT, gap=6):
    tf = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
    tf.word_wrap = True
    for i, (t, size, color, bold) in enumerate(runs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(gap)
        r = p.add_run()
        r.text = t
        r.font.size, r.font.color.rgb, r.font.bold, r.font.name = Pt(size), color, bold, FONT
    return tf


def shape(slide, kind, x, y, w, h, fill, line=None):
    s = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    if line:
        s.line.color.rgb = line
    else:
        s.line.fill.background()
    s.shadow.inherit = False
    return s


def build(slide):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = BG
    pill = shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.7, 0.45, 1.6, 0.38, TERRA)
    pill.adjustments[0] = 0.5
    tf = pill.text_frame
    tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "기획 한눈에"
    r.font.size, r.font.bold, r.font.name, r.font.color.rgb = Pt(13), True, FONT, CARD
    tb(slide, 0.7, 0.9, 12, 0.8, [("인디 리스너의 '나눌 곳 없는 취향'을, AI와 감상 기록으로 잇는다", 28, INK, True)])

    cw, gap, top, h = 2.85, 0.27, 1.95, 4.75
    for i, (num, head, lines) in enumerate(COLS):
        x = 0.7 + i * (cw + gap)
        dark = i == 3
        card = shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, top, cw, h, INK if dark else CARD, None if dark else LINE)
        card.adjustments[0] = 0.06
        # 번호 동그라미 + 소제목
        c = shape(slide, MSO_SHAPE.OVAL, x + 0.25, top + 0.28, 0.42, 0.42, TERRA)
        ctf = c.text_frame
        ctf.margin_left = ctf.margin_right = ctf.margin_top = ctf.margin_bottom = 0
        ctf.vertical_anchor = MSO_ANCHOR.MIDDLE
        cp = ctf.paragraphs[0]
        cp.alignment = PP_ALIGN.CENTER
        cr = cp.add_run()
        cr.text = num
        cr.font.size, cr.font.bold, cr.font.name, cr.font.color.rgb = Pt(14), True, FONT, CARD
        tb(slide, x + 0.75, top + 0.24, cw - 0.9, 0.5, [(head, 18, TERRA if not dark else RGBColor(0xF0, 0xB0, 0x8C), True)])
        size = 12.5 if dark else 13.5
        tb(slide, x + 0.25, top + 0.95, cw - 0.45, h - 1.1,
           [(("" if t[0] in "①②③④" else "•  ") + t, size, CARD if dark else INK, False) for t in lines], gap=9)
        # 칸 사이 화살표
        if i < 3:
            a = shape(slide, MSO_SHAPE.RIGHT_ARROW, x + cw + 0.02, top + h / 2 - 0.12, 0.23, 0.24, TERRA)
    tb(slide, 0.6, 7.0, 8, 0.4, [("결 · 음악의 결로 이어지다", 11, SUB, False)])
    tb(slide, 11.9, 7.0, 0.9, 0.4, [("3", 11, SUB, False)], align=PP_ALIGN.RIGHT)


def main(src, dst):
    prs = Presentation(src)
    # 뒤쪽 쪽번호(오른쪽 아래 숫자) 하나씩 밀기
    for n, s in enumerate(prs.slides, 1):
        if n < 3:
            continue
        for sh in s.shapes:
            if sh.has_text_frame and sh.left > Inches(11.5) and sh.top > Inches(6.8) and sh.text_frame.text.strip().isdigit():
                r = sh.text_frame.paragraphs[0].runs[0]
                r.text = str(int(r.text) + 1)
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    build(slide)
    # 맨 뒤에 생긴 슬라이드를 3번째 자리로 옮기기
    ids = prs.slides._sldIdLst
    el = ids[-1]
    ids.remove(el)
    ids.insert(2, el)
    prs.save(dst)
    print("완성:", dst, "/", len(prs.slides), "장")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
