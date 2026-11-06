"""
결 발표 PPT 만들기
실행:  python scripts/build_ppt.py   →  docs/결_발표자료.pptx
- slides/ 의 핸드폰 캡처(찍은 순서)를 화면별로 한 장씩 넣고, 옆에 설명 멘트를 붙인다
- 개인정보(나의 페이지 이메일)는 가린 사본을 docs/slides/ 에 만들어 쓴다
"""
import glob
import os
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sorted(glob.glob(os.path.join(ROOT, "slides", "*.jpg")))
OUT_IMG = os.path.join(ROOT, "docs", "slides")
OUT = os.path.join(ROOT, "docs", "결_발표자료.pptx")

BG = RGBColor(0xF4, 0xED, 0xE2)      # 베이지
CARD = RGBColor(0xFF, 0xFB, 0xF2)
TERRA = RGBColor(0xC2, 0x65, 0x3A)   # 테라코타
INK = RGBColor(0x2B, 0x24, 0x20)
SUB = RGBColor(0x8A, 0x7E, 0x72)
SAGE = RGBColor(0x6B, 0x7F, 0x55)
FONT = "맑은 고딕"


def prepare_images():
    """캡처를 순서대로 복사. 12번(나의 페이지)은 이메일 줄을 가린다"""
    os.makedirs(OUT_IMG, exist_ok=True)
    paths = []
    for i, f in enumerate(SRC):
        im = Image.open(f).convert("RGB")
        if i == 12:  # 나의 페이지: 이메일 가리기
            d = ImageDraw.Draw(im)
            d.rectangle([100, 280, 1060, 350], fill=(255, 251, 242))
            d.text((118, 290), "(이메일은 가렸어요) · 2026. 11. 6. 가입", fill=(138, 126, 114),
                   font=ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 36))
        p = os.path.join(OUT_IMG, f"{i:02d}.jpg")
        im.save(p, quality=88)
        paths.append(p)
    return paths


prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]


def base():
    s = prs.slides.add_slide(BLANK)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = BG
    return s


def text(s, x, y, w, h, lines, size=18, color=INK, bold=False, align=PP_ALIGN.LEFT, gap=6):
    """lines: 문자열 또는 (문자열, 크기, 색, 굵게) 목록"""
    tf = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
    tf.word_wrap = True
    for n, ln in enumerate(lines if isinstance(lines, list) else [lines]):
        t, sz, c, b = (ln, size, color, bold) if isinstance(ln, str) else ln
        p = tf.paragraphs[0] if n == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(gap)
        r = p.add_run()
        r.text = t
        r.font.size, r.font.bold, r.font.name = Pt(sz), b, FONT
        r.font.color.rgb = c
    return tf


def pill(s, x, y, label, fill=TERRA, color=CARD, size=13):
    w = 0.4 + len(label) * 0.17
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(0.38))
    sh.adjustments[0] = 0.5
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    sh.line.fill.background()
    tf = sh.text_frame
    tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.size, r.font.bold, r.font.name = Pt(size), True, FONT
    r.font.color.rgb = color
    return w


def logo(s, x, y, d):
    """CD 로고: 검은 원 + 테라코타 가운데 + G"""
    o = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(d), Inches(d))
    o.fill.solid()
    o.fill.fore_color.rgb = INK
    o.line.fill.background()
    k = d * 0.42
    c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + (d - k) / 2), Inches(y + (d - k) / 2), Inches(k), Inches(k))
    c.fill.solid()
    c.fill.fore_color.rgb = TERRA
    c.line.fill.background()
    tf = c.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "G"
    r.font.size, r.font.bold, r.font.name = Pt(d * 20), True, FONT
    r.font.color.rgb = CARD


def footer(s, n, x=0.6):
    text(s, x, 7.0, 8, 0.4, [("결 · 음악의 결로 이어지다", 11, SUB, False)])
    text(s, 11.9, 7.0, 0.9, 0.4, [(str(n), 11, SUB, False)], align=PP_ALIGN.RIGHT)


def screen_slide(img, step, title, points, tags, n):
    """왼쪽: 핸드폰 캡처 / 오른쪽: 단계 · 제목 · 설명 멘트 · 심사 항목"""
    s = base()
    w, h = Image.open(img).size
    ih = 6.6
    iw = ih * w / h
    if iw > 4.4:  # 가로로 넓은 캡처는 너비 기준
        iw, ih = 4.4, 4.4 * h / w
    x, y = 0.8 + (4.4 - iw) / 2, (7.5 - ih) / 2
    frame = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x - 0.08), Inches(y - 0.08),
                               Inches(iw + 0.16), Inches(ih + 0.16))
    frame.adjustments[0] = 0.04
    frame.fill.solid()
    frame.fill.fore_color.rgb = INK
    frame.line.fill.background()
    s.shapes.add_picture(img, Inches(x), Inches(y), Inches(iw), Inches(ih))
    pill(s, 6.0, 1.0, step)
    text(s, 6.0, 1.55, 6.8, 1.0, [(title, 32, INK, True)])
    text(s, 6.0, 2.7, 6.7, 3.5, [("•  " + p, 18, INK, False) for p in points], gap=14)
    tx = 6.0
    for t in tags:
        tx += pill(s, tx, 6.25, "[" + t + "]", fill=RGBColor(0xE6, 0xEB, 0xDD), color=SAGE, size=12) + 0.12
    footer(s, n, x=6.0)


def text_slide(step, title, blocks, n):
    """글 위주 슬라이드: blocks = [(소제목, [설명...])]"""
    s = base()
    pill(s, 0.9, 0.7, step)
    text(s, 0.9, 1.2, 11.5, 0.9, [(title, 32, INK, True)])
    cols = len(blocks)
    cw = (11.5 - 0.3 * (cols - 1)) / cols
    for i, (head, body) in enumerate(blocks):
        bx = 0.9 + i * (cw + 0.3)
        card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(bx), Inches(2.4), Inches(cw), Inches(4.2))
        card.adjustments[0] = 0.08
        card.fill.solid()
        card.fill.fore_color.rgb = CARD
        card.line.color.rgb = RGBColor(0xE4, 0xD9, 0xC6)
        text(s, bx + 0.3, 2.65, cw - 0.6, 0.8, [(head, 20, TERRA, True)])
        text(s, bx + 0.3, 3.4, cw - 0.6, 3.1, [(b, 15, INK, False) for b in body], gap=10)
    footer(s, n)


# 캡처 순서대로: (단계, 제목, 설명 멘트, 심사 항목)
SCREENS = [
    ("해결 · 한 바퀴", "검색 → 기록 → 연결 → 발견",
     ["좋아하는 노래를 찾고(①) 감상을 남기면(②)",
      "AI가 듣는 이유를 읽어 같은 결의 사람과 이어 주고(③)",
      "그 사람에게서 다른 결의 인디를 발견해요(④)",
      "발견한 곡을 다시 기록 → 돌면서 취향이 넓어져요"], ["문제정의", "확장성"]),
    ("시작", "10초 회원가입",
     ["이메일 + 비밀번호만으로 바로 가입 (이메일 인증 없음)",
      "비밀번호는 암호화해서 저장, 8자 이상 영문+숫자",
      "다른 사람에게는 닉네임만 보여요",
      "로그인 없이도 검색·추천은 쓸 수 있어요"], ["구현"]),
    ("① 검색", "아티스트 · 노래 검색",
     ["'우효'처럼 이름만 쳐도 아티스트와 노래가 함께 나와요",
      "음악 DB에 영어로 등록된 곡도 한국어 원제로 보여줘요 (Dandelion → 민들레)",
      "결이 직접 정리한 인디 아티스트에는 '결 큐레이션' 표시"], ["구현"]),
    ("① 검색 · 노래", "곡 이야기와 AI 소개",
     ["결 큐레이션: 직접 정리한 소개 + 출처 링크",
      "곡 이야기: 출처가 있는 수상·후보 기록만 보여줘요",
      "AI 소개 + '이럴 때 들어 보세요' 들을 상황 추천",
      "유튜브에서 바로 듣기"], ["AI활용", "구현"]),
    ("② 나의 음악 저장소", "나만의 감상 노트",
     ["노래마다 생각·장면·좋아하는 부분을 기록",
      "기본은 '나만 보기'(비공개), 원할 때만 공개",
      "다른 사람들의 공개 감상에 하트·댓글",
      "비공개 기록은 DB 권한 규칙으로 보호"], ["구현", "문제정의"]),
    ("② 나의 음악 저장소", "아티스트 감상과 좋아요",
     ["아티스트를 좋아요하고 감상을 남겨요",
      "장르·분위기 태그로 아티스트의 결을 한눈에",
      "'결 팬' 수, 대표곡, 다른 사람들의 감상"], ["구현"]),
    ("② 나의 음악 저장소", "내 기록을 한곳에",
     ["음악 / 아티스트 탭으로 내 감상 모아 보기",
      "수정 · 공개 범위 바꾸기 · 삭제",
      "이 기록이 AI 취향 분석의 재료가 돼요"], ["구현"]),
    ("③ 취향으로 연결", "AI 취향 분석",
     ["내 감상 노트를 AI가 읽고 '음악을 듣는 이유'를 한 문단으로 요약",
      "#비오는새벽 #분위기파 같은 결 태그 생성",
      "연결을 켜도 공유되는 건 요약뿐, 메모 원문은 공유 안 함"], ["AI활용", "문제정의"]),
    ("③ 취향으로 연결", "같은 결의 사람 찾기",
     ["같은 노래: 내가 감상한 곡에 공개 감상을 남긴 사람",
      "같은 아티스트: 곡은 달라도 같은 아티스트를 좋아하는 사람",
      "같은 이유(AI): 듣는 곡이 달라도 듣는 이유가 닮은 사람",
      "연결에 동의한 사람끼리만 매칭"], ["AI활용", "문제정의"]),
    ("③ 취향으로 연결", "공개된 감상 노트",
     ["나에게 맞춘 순: 좋아하는 아티스트·같은 곡 + 반응 + 최신",
      "인기순 · 최신순으로도 볼 수 있어요",
      "한 사람이 도배하지 않도록 사람당 2개까지"], ["구현", "확장성"]),
    ("④ 새로운 발견", "그 사람의 공개 프로필",
     ["다른 사람에게는 공개한 감상만 보여요",
      "버튼 하나로 'AI로 이 사람에게서 새 음악 발견'"], ["구현"]),
    ("④ 새로운 발견", "다른 결, 하나의 공통점",
     ["비슷한 음악만 들으면 취향이 좁아져요",
      "AI가 평소와 '다른 결'의 인디를 고르고 '평소 나 vs 이 아티스트'를 비교",
      "그래도 통하는 공통점 하나 + 들을 상황 + 추천곡",
      "실제로 있는 아티스트·곡만 (음악 DB로 확인)"], ["AI활용", "문제정의"]),
    ("나의 페이지", "내 계정과 기록 한눈에",
     ["노래·아티스트 감상 수와 공개 수",
      "나의 취향 분석 요약, 연결 켜짐/꺼짐",
      "이메일은 나에게만, 다른 사람에게는 닉네임만"], ["구현"]),
]


def main():
    img = prepare_images()
    assert len(img) == len(SCREENS), f"캡처 {len(img)}장 / 설명 {len(SCREENS)}개"
    n = 1
    # 표지
    s = base()
    logo(s, 0.9, 1.2, 1.4)
    text(s, 2.55, 1.45, 6, 1.0, [("결", 44, INK, True)])
    text(s, 0.9, 3.0, 11, 1.8, [("나의 인디 결을 찾아", 48, INK, True), ("디깅하자", 48, TERRA, True)], gap=0)
    text(s, 0.9, 5.0, 11.5, 1.4, [("결 (Gyeol) · 음악의 결로 이어지다", 22, INK, True),
                                  ("감상을 기록하면 AI가 '음악을 듣는 결'을 읽고, 같은 결의 사람과 새로운 인디 음악으로 이어 주는 서비스",
                                   16, SUB, False)])
    n += 1
    # 문제
    text_slide("문제 정의", "인디 음악을 좋아하면, 추천받기도 이야기하기도 어렵다", [
        ("추천에 안 뜬다", ["기존 추천은 '이 곡을 들은 사람이 저 곡도 들었다' 방식",
                       "듣는 사람이 적은 인디는 데이터가 적어 추천 목록에 잘 안 나온다"]),
        ("이유를 모른다", ["왜 이 곡을 추천했는지 설명이 없다",
                       "장르 이름만으로는 내가 좋아하는 '결'(분위기·상황·이유)을 찾기 어렵다"]),
        ("나눌 사람이 없다", ["주변에 같은 인디를 듣는 사람이 드물다",
                        "감상을 남기고 같은 결의 사람을 만날 곳이 없다"]),
    ], n)
    n += 1
    # 화면 슬라이드
    for p, (step, title, pts, tags) in zip(img, SCREENS):
        screen_slide(p, step, title, pts, tags, n)
        n += 1
    # AI 역할 · 신뢰 장치
    text_slide("AI 활용", "AI가 하는 일, 그리고 지어내지 않게 하는 장치", [
        ("AI가 하는 일", ["감상 노트 → 듣는 이유(결) 요약·태그",
                       "같은 이유를 가진 사람 매칭",
                       "다른 결 + 공통점 추천, 곡 소개·들을 상황"]),
        ("환각 막기", ["AI가 말한 아티스트·곡은 음악 DB(Deezer)로 실제 있는지 확인",
                    "준비된 후보 안에서 번호로만 고르게 함",
                    "수상 기록 같은 사실은 출처 있는 데이터만"]),
        ("개인정보 · 보안", ["기록 기본값은 비공개, DB 권한 규칙으로 보호",
                        "매칭에는 동의한 사람의 요약만 사용",
                        "AI 키는 서버에서만, 호출 횟수 제한"]),
    ], n)
    n += 1
    # 차별점
    text_slide("차별점", "기존 음악 앱 추천과 무엇이 다른가", [
        ("결로 추천", ["재생 수가 아니라 분위기·사운드·듣는 이유로 연결",
                         "듣는 사람이 적은 인디도 똑같이 추천"]),
        ("이유 설명", ["왜 추천했는지, 평소 나와 무엇이 다르고 같은지 설명"]),
        ("사람과 연결", ["감상이 쌓이면 같은 결의 사람을 만나고",
                         "그 사람에게서 새 음악을 발견"]),
        ("앱 무관", ["멜론·스포티파이·유튜브 뮤직 무엇을 쓰든 사용"]),
    ], n)
    n += 1
    # 확장
    text_slide("확장성", "앞으로의 계획", [
        ("공연으로", ["추천 아티스트의 공연 일정 연결",
                   "같은 결의 사람과 공연 같이 가기"]),
        ("데이터 넓히기", ["큐레이션 아티스트 확대",
                       "한국어 제목 사용자 제보",
                       "페스티벌 라인업과 연계"]),
        ("취향 타임라인", ["기록이 쌓이며 내 결이 어떻게 바뀌었는지 보여주기"]),
    ], n)
    prs.save(OUT)
    print("완성:", OUT, "/ 슬라이드", n, "장")


if __name__ == "__main__":
    main()
