#!/usr/bin/env python3
"""Generate the logo exploration boards for artboard/anjian-interface (page: logo)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from final_logo import tile_body, color_body, mono_body, LIGHT, DARK
_uid = [0]

OUT = Path(sys.argv[1])
ACC, ACC_D = "#b4512f", "#ed9b7d"
INK, INK_D = "#2a2420", "#efe7dd"
CREAM, TILE_D = "#f6efe6", "#2a2521"


def mark(kind, ink, acc, bg):
    if kind == "door":
        return (f'<rect x="14.6" y="8.6" width="7.2" height="10.5" rx="3.6" transform="rotate(-38 18.2 13.8)" fill="{ink}"/>'
                f'<rect x="14.4" y="21.5" width="7.2" height="30.5" rx="3.6" fill="{ink}"/>'
                f'<path d="M28 14.5h17.5a4.5 4.5 0 0 1 4.5 4.5v29.4" fill="none" stroke="{ink}" stroke-width="7.2" stroke-linecap="round"/>'
                f'<rect x="28" y="25.5" width="14.5" height="17" rx="3" fill="{acc}"/>')
    if kind == "boards":
        return (f'<rect x="9.5" y="17.5" width="28" height="34" rx="6" fill="none" stroke="{ink}" stroke-width="5"/>'
                f'<rect x="24" y="11" width="31" height="37" rx="6.5" fill="{acc}"/>'
                f'<path d="M33.5 37V30a8 8 0 1 1 8 8h-7a1 1 0 0 1-1-1Z" fill="{bg}"/>')
    if kind == "pin":
        return (f'<path d="M11 51V32a21 21 0 1 1 21 21H13a2 2 0 0 1-2-2Z" fill="{acc}"/>'
                f'<rect x="23" y="23" width="18" height="18" rx="4.5" fill="{bg}"/>')
    if kind == "seal":
        return (f'<rect x="7" y="7" width="50" height="50" rx="11" fill="{acc}"/>'
                f'<rect x="11.5" y="11.5" width="41" height="41" rx="7.5" fill="none" stroke="{bg}" stroke-width="1.6" opacity=".55"/>'
                f'<text x="32" y="30" text-anchor="middle" font-family="Songti SC,STSong,Noto Serif SC,serif" font-weight="900" font-size="16.5" fill="{bg}">案</text>'
                f'<text x="32" y="48.5" text-anchor="middle" font-family="Songti SC,STSong,Noto Serif SC,serif" font-weight="900" font-size="16.5" fill="{bg}">间</text>')
    if kind == "select":
        hs = "".join(f'<rect x="{x-5}" y="{y-5}" width="10" height="10" rx="2" fill="{bg}" stroke="{ink}" stroke-width="3.2"/>'
                     for x, y in ((13, 13), (51, 13), (13, 51), (51, 51)))
        return (f'<rect x="13" y="13" width="38" height="38" fill="none" stroke="{ink}" stroke-width="3.2"/>'
                f'<rect x="21" y="21" width="22" height="22" rx="4.5" fill="{acc}"/>' + hs)
    if kind == "stack":
        return (f'<rect x="23" y="7" width="31" height="37" rx="6.5" fill="{acc}" opacity=".26"/>'
                f'<rect x="16.5" y="13.5" width="31" height="37" rx="6.5" fill="{acc}" opacity=".55"/>'
                f'<rect x="10" y="20" width="31" height="37" rx="6.5" fill="{acc}"/>'
                f'<path d="M18 47v-6.5a6.5 6.5 0 1 1 6.5 6.5H19a1 1 0 0 1-1-1Z" fill="{bg}"/>')
    if kind == "label":
        return (f'<rect x="10" y="10" width="21" height="9" rx="3" fill="{acc}"/>'
                f'<rect x="10.5" y="23.5" width="43" height="31" rx="6" fill="none" stroke="{ink}" stroke-width="5"/>'
                f'<path d="M39 57V48a9 9 0 1 1 9 9h-8a1 1 0 0 1-1-1Z" fill="{acc}" stroke="{bg}" stroke-width="3.5" paint-order="stroke"/>')
    if kind == "doorsel":
        hs = "".join(f'<rect x="{x-2.2}" y="{y-2.2}" width="4.4" height="4.4" rx="1" fill="{bg}" stroke="{acc}" stroke-width="1.7"/>'
                     for x, y in ((26, 25.5), (43, 25.5), (26, 42.5), (43, 42.5)))
        return (f'<rect x="14.6" y="8.6" width="7.2" height="10.5" rx="3.6" transform="rotate(-38 18.2 13.8)" fill="{ink}"/>'
                f'<rect x="14.4" y="21.5" width="7.2" height="30.5" rx="3.6" fill="{ink}"/>'
                f'<path d="M28 14.5h17.5a4.5 4.5 0 0 1 4.5 4.5v29.4" fill="none" stroke="{ink}" stroke-width="7.2" stroke-linecap="round"/>'
                f'<rect x="26" y="25.5" width="17" height="17" fill="none" stroke="{acc}" stroke-width="1.6"/>'
                f'<rect x="29" y="28.5" width="11" height="11" rx="2.2" fill="{acc}"/>' + hs)
    raise ValueError(kind)


def svg(kind, size, dark=False, tile=True, cls=""):
    if kind == "final":
        c = DARK if dark else LIGHT
        return (f'<svg class="{cls}" width="{size}" height="{size}" viewBox="0 0 64 64" aria-hidden="true">'
                f'{tile_body(c) if tile else color_body(c)}</svg>')
    ink, acc = (INK_D, ACC_D) if dark else (INK, ACC)
    tbg = TILE_D if dark else CREAM
    # Tile-less marks (pin, seal) carry their own shape; others sit on a tile.
    own_shape = kind in ("pin", "seal")
    inner_bg = (tbg if not own_shape else ("#1d1916" if dark else "#fff"))
    body = mark(kind, ink, acc, inner_bg)
    back = ""
    if tile and not own_shape:
        back = f'<rect width="64" height="64" rx="15" fill="{tbg}"/>'
        body = f'<g transform="translate(32 32) scale(.8) translate(-32 -32)">{body}</g>'
    return (f'<svg class="{cls}" width="{size}" height="{size}" viewBox="0 0 64 64" aria-hidden="true">'
            f'{back}{body}</svg>')


OPTIONS = [
    ("logo-a", "door", "A · 门中见日",
     "“间”字拆开是门里有日：门框是工作台，暖色方块是摆进来的作品。笔画少，16px 仍认得出门的轮廓。"),
    ("logo-b", "boards", "B · 两板一针",
     "后面是线框画板，前面是陶土色作品，上面一枚批注针，直接说明“方案之间的讨论”。"),
    ("logo-c", "pin", "C · 落点",
     "沿用界面里的批注针形状，中间落下一块作品。呼应“让讨论有个落点”，和产品里的批注图形一致。"),
    ("logo-d", "seal", "D · 印章",
     "方印加宋体“案间”，中文气质最强；但依赖字形，20px 以下难以辨认，需要另配简化小图标。"),
]

CSS = """
*{box-sizing:border-box}html,body{margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#fcfbf9;color:#25221e;-webkit-font-smoothing:antialiased;width:1280px;height:800px;padding:40px;display:grid;grid-template-columns:540px 1fr;gap:24px}
.hero{border-radius:22px;background:#f3efe9;background-image:radial-gradient(#ddd5ca 1px,transparent 1.3px);background-size:16px 16px;box-shadow:0 0 0 1px rgb(37 34 30 / .07);display:flex;flex-direction:column;overflow:hidden}
.stage{flex:1;display:grid;place-items:center}
.stage svg{filter:drop-shadow(0 18px 28px rgb(90 52 32 / .22)) drop-shadow(0 2px 4px rgb(90 52 32 / .12))}
.cap{background:#fff;padding:22px 26px 24px;box-shadow:inset 0 1px 0 #ebe6df}
.cap h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em}
.cap p{margin:8px 0 0;font-size:14.5px;line-height:1.75;color:#4b463f;text-wrap:pretty}
.col{display:grid;grid-template-rows:auto auto 1fr;gap:16px;min-width:0}
.card{border-radius:18px;background:#fff;box-shadow:0 0 0 1px rgb(37 34 30 / .07),0 3px 8px -3px rgb(37 34 30 / .07);padding:20px 22px}
.card.dk{background:#1d1b18;color:#efeae3;box-shadow:0 0 0 1px rgb(255 255 255 / .06)}
.lbl{font-size:12.5px;font-weight:600;color:#7b746b;margin-bottom:14px}
.dk .lbl{color:#9b9389}
.lockups{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.lock{display:flex;align-items:center;gap:14px}
.word{font-size:32px;font-weight:700;letter-spacing:.06em;line-height:1}
.word small{display:block;font-size:12px;font-weight:500;letter-spacing:.12em;color:#7b746b;margin-top:8px}
.dk .word small{color:#9b9389}
.sizes{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.ladder{display:flex;align-items:flex-end;gap:22px}
.ladder span{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11px;color:#9b9389;font-variant-numeric:tabular-nums}
.ctx{display:flex;flex-direction:column;gap:12px}
.bar.dk2{background:#181715;color:#efeae3;box-shadow:inset 0 0 0 1px #312d28}.bar.dk2 .chip{background:#1f1d1a;color:#9b9389;box-shadow:inset 0 0 0 1px #312d28}.bar.dk2 .nav{color:#9b9389}
.mono{display:flex;align-items:center;gap:14px;font-size:12.5px;color:#7b746b}.mono i{font-style:normal;margin-right:10px}
.mono .sw{width:52px;height:52px;border-radius:13px;display:grid;place-items:center}
.bar{height:56px;border-radius:12px;background:#fcfbf9;box-shadow:inset 0 0 0 1px #ebe6df;display:flex;align-items:center;gap:10px;padding:0 16px;font-size:16px;font-weight:650;letter-spacing:.04em}
.chip{font-size:11.5px;font-weight:500;letter-spacing:0;color:#7b746b;background:#f6f3ee;box-shadow:inset 0 0 0 1px #ebe6df;padding:1px 8px;border-radius:999px}
.nav{margin-left:18px;display:flex;gap:18px;font-size:13.5px;font-weight:400;letter-spacing:0;color:#7b746b}
.tabs{display:flex;gap:2px;background:#e9e4dc;border-radius:12px;padding:6px 6px 0;height:46px}
.tab{display:flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:9px 9px 0 0;font-size:12.5px;color:#4b463f;width:210px}
.tab.on{background:#fcfbf9;color:#25221e}
.tab.dim{opacity:.7}
"""


def mono(kind, fg, bg):
    if kind == "final":
        _uid[0] += 1
        return f'<svg width="36" height="36" viewBox="0 0 64 64" style="color:{fg}" aria-hidden="true">{mono_body(f"m{_uid[0]}")}</svg>'
    return f'<svg width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">{mark(kind, fg, fg, bg)}</svg>'


def board(oid, kind, title, why):
    light_lock = f'<div class="lock">{svg(kind, 56)}<div class="word">案间<small>ANJIAN</small></div></div>'
    dark_lock = f'<div class="lock">{svg(kind, 56, dark=True)}<div class="word">案间<small>ANJIAN</small></div></div>'
    ladder = lambda dark: '<div class="ladder">' + "".join(
        f'<span>{svg(kind, s, dark=dark)}{s}</span>' for s in (64, 40, 28, 20, 16)) + "</div>"
    body = (
        f'<section class="hero"><div class="stage">{svg(kind, 232)}</div>'
        f'<div class="cap"><h2>{title}</h2><p>{why}</p></div></section>'
        '<div class="col">'
        f'<div class="lockups"><div class="card"><div class="lbl">标志组合 · 浅色</div>{light_lock}</div>'
        f'<div class="card dk"><div class="lbl">标志组合 · 深色</div>{dark_lock}</div></div>'
        f'<div class="sizes"><div class="card"><div class="lbl">尺寸 · 浅色</div>{ladder(False)}</div>'
        f'<div class="card dk"><div class="lbl">尺寸 · 深色</div>{ladder(True)}</div></div>'
        '<div class="card ctx"><div class="lbl" style="margin:0">放进界面</div>'
        f'<div class="bar">{svg(kind, 28)}案间<span class="chip">文档</span>'
        '<span class="nav"><span>使用指南</span><span>自托管</span><span>使用案例</span></span></div>'
        f'<div class="bar dk2">{svg(kind, 28, dark=True)}案间<span class="chip">文档</span>'
        '<span class="nav"><span>使用指南</span><span>自托管</span><span>使用案例</span></span></div>'
        f'<div class="tabs"><div class="tab on">{svg(kind, 16)}案间 · 首页探索</div>'
        f'<div class="tab dim">{svg(kind, 16)}案间 · 作品库</div></div>'
        f'<div class="mono"><i>单色</i><span class="sw" style="background:#f6f3ee">{mono(kind, "#25221e", "#f6f3ee")}</span>'
        f'<span class="sw" style="background:#b4512f">{mono(kind, "#fff", "#b4512f")}</span>'
        '<span>印刷、README 徽章与单色场景使用一种颜色。</span></div></div>'
        '</div>'
    )
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            f'<title>{title} · 案间标志探索</title><style>{CSS}</style></head><body>{body}</body></html>\n')


OPTIONS2 = [
    ("logo2-a", "doorsel", "A2 · 门里的作品",
     "保留“间”的门与日，把中间的方块换成被选中的作品：选中框和四个控制点就是画板里编辑作品的样子。"),
    ("logo2-b", "select", "B2 · 选中框",
     "画布工具最直接的符号：一件陶土色作品被选中。认知成本最低，但和设计工具的通用图标接近。"),
    ("logo2-c", "stack", "C2 · 三层作品（推荐）",
     "画板、文档、HTML 三种作品叠在一起，最前面一张带批注针。颜色由浅到深，单色时依靠透明度区分层次。"),
    ("logo2-d", "label", "D2 · 带标签的画板",
     "画板上方的标题标签、画框和角落的批注针，取自案间画布里每张稿件的样子。"),
]

OUT.mkdir(parents=True, exist_ok=True)
OPTIONS3 = [
    ("logo-final", "final", "案间标志 · 定稿（C2 三层作品）",
     "三层对应画板、文档、HTML 三种作品，最前面一张带批注针。陶土色由浅到深，单色版用遮罩挖出批注针，任何背景都成立。"),
]

for oid, kind, title, why in OPTIONS + OPTIONS2 + OPTIONS3:
    (OUT / f"{oid}.html").write_text(board(oid, kind, title, why), encoding="utf-8")
    print("wrote", oid)
