"""
사용자가 고친 발표 PPT에 '이렇게 눌러요'(어떤 버튼을 눌러야 실행되는지) 상자를 추가
실행:  python scripts/add_howto.py 입력.pptx 출력.pptx
- 사용자가 고친 내용은 그대로 두고, 화면 슬라이드(3~15장)에 상자만 더한다
"""
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN

TERRA = RGBColor(0xC2, 0x65, 0x3A)
INK = RGBColor(0x2B, 0x24, 0x20)
CARD = RGBColor(0xFF, 0xFB, 0xF2)
FONT = "맑은 고딕"

# 슬라이드 번호: 누르는 순서 (화면에 보이는 버튼 이름 그대로)
HOWTO = {
    3: "홈 화면의 ①~④ 카드를 누르면 그 단계 화면으로 바로 가요.",
    4: "오른쪽 위 [로그인] → [회원가입] 탭 → 입력 후 [가입하기]",
    5: "홈 [① 검색] 카드 → 검색창에 이름 입력 → 결과에서 아티스트·노래를 누르면 상세 페이지로",
    6: "검색 결과에서 노래 제목을 누르면 열려요. [비슷한 아티스트]·[비슷한 노래] 탭을 누르면 AI 추천",
    7: "노래 페이지 아래 '내 감상 노트'에 쓰고 [저장]. [나만 보기]를 누르면 [공개]로 바뀌어요.",
    8: "노래 페이지의 아티스트 이름(예: 한로로 ›)이나 검색 결과의 아티스트를 누르면 열려요. [♡ 좋아요]로 팬 등록",
    9: "홈 [② 나의 음악 저장소] 카드 → [음악]·[아티스트] 탭. 노래 제목을 누르면 노래 페이지로",
    10: "홈 [③ 취향으로 연결] → [AI로 취향 분석] (한 번 하면 [분석 다시하기]). 다른 사람과 이어지려면 [다른 사람과 연결하기] 체크",
    11: "같은 화면 아래 [취향이 닮은 사람 찾기] (한 번 하면 [다시 찾기]) → 사람 카드의 [이 사람에게서 새 음악 발견]",
    12: "[③ 취향으로 연결] 화면 맨 아래. [나에게 맞춘 순]은 로그인했을 때만 보여요. @닉네임을 누르면 그 사람 프로필로",
    13: "감상 노트의 @닉네임을 누르면 열려요 → [AI로 이 사람에게서 새 음악 발견]",
    14: "홈 [④ 새로운 발견] → [다른 결의 인디 추천받기] (한 번 하면 [다시 추천받기])",
    15: "오른쪽 위 [@닉네임] 버튼. 숫자 칸을 누르면 나의 음악 저장소의 해당 탭으로 가요.",
}


def add_box(slide, msg):
    box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.0), Inches(5.08), Inches(6.7), Inches(1.0))
    box.adjustments[0] = 0.15
    box.fill.solid()
    box.fill.fore_color.rgb = CARD
    box.line.color.rgb = TERRA
    box.line.width = Pt(1.25)
    box.shadow.inherit = False
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Inches(0.2)
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    r = p.add_run()
    r.text = "👉 이렇게 눌러요   "
    r.font.size, r.font.bold, r.font.name = Pt(14), True, FONT
    r.font.color.rgb = TERRA
    r = p.add_run()
    r.text = msg
    r.font.size, r.font.bold, r.font.name = Pt(14), False, FONT
    r.font.color.rgb = INK


def main(src, dst):
    prs = Presentation(src)
    for n, slide in enumerate(prs.slides, 1):
        if n in HOWTO:
            add_box(slide, HOWTO[n])
    prs.save(dst)
    print("완성:", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
