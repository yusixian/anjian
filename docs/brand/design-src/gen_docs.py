#!/usr/bin/env python3
"""Generate the docs-site boards of artboard/anjian-interface from one design system."""
import sys
from pathlib import Path

OUT = Path(sys.argv[1])

P = {
    "search": '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    "moon": '<path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6Z"/>',
    "github": '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "left": '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    "out": '<path d="M7 17 17 7M8 7h9v9"/>',
    "chev": '<path d="m9 6 6 6-6 6"/>',
    "down": '<path d="m6 9 6 6 6-6"/>',
    "copy": '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    "term": '<path d="m5 17 5-5-5-5M12 19h7"/>',
    "info": '<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5M12 8h.01"/>',
    "laptop": '<rect x="4" y="4.5" width="16" height="11" rx="1.8"/><path d="M2 19.5h20"/>',
    "link": '<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.9-2.9a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.9 2.9a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/>',
    "users": '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6"/>',
    "board": '<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.5"/><rect x="3" y="15" width="7.5" height="6" rx="1.5"/>',
    "doc": '<path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-12Z"/><path d="M14 2.5v5h5.5M9 13h6M9 17h4"/>',
    "code": '<path d="m16 17 5-5-5-5M8 7l-5 5 5 5"/>',
    "check": '<path d="M20 6.5 9.5 17 4 11.5"/>',
    "pkg": '<path d="M12 21.5 3.5 16.8V7.2L12 2.5l8.5 4.7v9.6Z"/><path d="M3.8 7.4 12 12l8.2-4.6M12 12v9.5"/>',
    "branch": '<circle cx="6" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 8.5v7M18 9.5a7 7 0 0 1-7 7H8.5"/>',
    "toc": '<path d="M4 6h16M8 12h12M8 18h12"/>',
    "msg": '<path d="M20.5 14.5a2 2 0 0 1-2 2H8l-4.5 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"/>',
    "ptr": '<path d="M4.5 4.5 11 20l2.3-6.7L20 11Z"/>',
    "hand": '<path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10.5V4.5a1.5 1.5 0 0 0-3 0v6M12 10V5.5a1.5 1.5 0 0 0-3 0V13"/><path d="M18 8.5a1.5 1.5 0 0 1 3 0V14a7.5 7.5 0 0 1-7.5 7.5h-1.2a7.5 7.5 0 0 1-5.4-2.3L3.6 15.8a1.6 1.6 0 0 1 2.3-2.3L9 16"/>',
    "share": '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v5.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V13"/>',
}


def i(name, cls="i"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{P[name]}</svg>'


sys.path.insert(0, str(Path(__file__).parent))
from final_logo import tile_body, DARK  # noqa: E402

LOGO = f'<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">{tile_body()}</svg>'
LOGO_DARK = f'<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">{tile_body(DARK)}</svg>'

CSS = r"""
*{box-sizing:border-box}html,body{margin:0}
body{
 --bg:#fcfbf9;--bg2:#f6f3ee;--canvas:#f3efe9;--dot:#ddd5ca;--card:#fff;
 --ink:#25221e;--ink2:#4b463f;--muted:#7b746b;--line:#ebe6df;--line2:#ddd6cc;
 --accent:#b4512f;--on-accent:#fff;--tint:#f8ece5;--tint-line:#efd6c8;--ok:#4c8a5a;--ok-tint:#e6f1e8;
 --code:#f8f5f0;--glow:rgb(222 140 102 / .16);
 --ring:0 0 0 1px rgb(37 34 30 / .07);
 --sh-sm:var(--ring),0 1px 2px rgb(37 34 30 / .04),0 3px 8px -3px rgb(37 34 30 / .07);
 --sh-md:var(--ring),0 2px 4px rgb(66 48 36 / .05),0 12px 28px -12px rgb(66 48 36 / .2);
 --sh-lg:var(--ring),0 2px 6px rgb(66 48 36 / .05),0 18px 40px -16px rgb(66 48 36 / .22),0 40px 80px -40px rgb(66 48 36 / .26);
 --img-outline:oklch(0 0 0 / .1);
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
 background:var(--bg);color:var(--ink);font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body.dark{
 --bg:#181715;--bg2:#1f1d1a;--canvas:#1c1a17;--dot:#38332d;--card:#23211d;
 --ink:#efeae3;--ink2:#cfc7bd;--muted:#9b9389;--line:#312d28;--line2:#3d3832;
 --accent:#ed9b7d;--on-accent:#24150f;--tint:#33241d;--tint-line:#4a3127;--ok:#86c194;--ok-tint:#1f3024;
 --code:#1d1b18;--glow:rgb(237 155 125 / .10);
 --ring:0 0 0 1px rgb(255 255 255 / .07);
 --sh-sm:var(--ring),0 1px 2px rgb(0 0 0 / .3);
 --sh-md:var(--ring),0 12px 28px -12px rgb(0 0 0 / .6);
 --sh-lg:var(--ring),0 18px 40px -16px rgb(0 0 0 / .6),0 40px 80px -40px rgb(0 0 0 / .7);
 --img-outline:oklch(1 0 0 / .1)}
a{color:inherit;text-decoration:none}
.i{width:18px;height:18px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.logo{width:28px;height:28px;flex-shrink:0;display:block}
.dark .logo{border-radius:6.6px;box-shadow:0 0 0 1px rgb(255 255 255 / .09)}
.num-t{font-variant-numeric:tabular-nums}

/* top bar */
.top{height:64px;display:flex;align-items:center;gap:28px;padding:0 28px 0 32px;border-bottom:1px solid var(--line);background:var(--bg);position:relative;z-index:2}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:17px;letter-spacing:.04em;white-space:nowrap}
.chip{font-size:12px;font-weight:500;letter-spacing:0;color:var(--muted);background:var(--bg2);box-shadow:inset 0 0 0 1px var(--line);padding:1px 8px;border-radius:999px;line-height:20px}
.nav{display:flex;gap:2px;font-size:14px}
.nav a{padding:6px 12px;border-radius:8px;color:var(--muted)}
.nav a.on{color:var(--ink);background:var(--bg2);font-weight:550}
.top-end{margin-left:auto;display:flex;align-items:center;gap:4px}
.search{width:240px;height:38px;display:flex;align-items:center;gap:10px;padding:0 7px 0 12px;border-radius:10px;background:var(--bg2);box-shadow:inset 0 0 0 1px var(--line);color:var(--muted);font-size:14px;margin-right:8px}
.search .i{width:17px;height:17px}
kbd{margin-left:auto;font:500 11px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--muted);background:var(--card);box-shadow:inset 0 0 0 1px var(--line),0 1px 0 var(--line2);padding:4px 6px;border-radius:5px}
.ib{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;color:var(--ink2)}
.ib .i{width:20px;height:20px}
.mob{display:none}

/* buttons */
.btn{height:44px;padding:0 18px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:15px;font-weight:600;white-space:nowrap}
.btn .i{width:17px;height:17px}
.btn-primary{background:var(--accent);color:var(--on-accent);box-shadow:inset 0 1px 0 rgb(255 255 255 / .16),0 1px 2px rgb(120 48 24 / .28),0 6px 16px -6px rgb(180 81 47 / .5)}
.btn-ghost{background:var(--card);color:var(--ink);box-shadow:var(--sh-sm)}
.btn-sm{height:36px;padding:0 14px;font-size:14px;border-radius:9px}

/* home */
.home-bg{background:radial-gradient(760px 420px at 82% -40px,var(--glow),transparent 72%)}
.home{max-width:1120px;margin:0 auto;padding:0 40px}
.hero{display:grid;grid-template-columns:minmax(0,1fr) 540px;gap:56px;align-items:center;padding:64px 0 88px}
.display{text-wrap:balance;font-size:52px;line-height:1.24;letter-spacing:-.02em;font-weight:700;margin:0}
.display em{font-style:normal;color:var(--accent)}
.hero-copy{text-wrap:pretty;font-size:17px;line-height:1.85;color:var(--ink2);margin:22px 0 0}
.cta{display:flex;gap:12px;margin-top:34px}
.sec{padding-bottom:72px}
.sec-h{margin:0 0 20px;font-size:22px;font-weight:650;letter-spacing:-.01em;line-height:1.4}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.card{background:var(--card);border-radius:16px;box-shadow:var(--sh-sm)}
.path{padding:22px 22px 20px;display:flex;flex-direction:column}
.tile{width:40px;height:40px;border-radius:10px;background:var(--tint);color:var(--accent);display:grid;place-items:center;box-shadow:inset 0 0 0 1px var(--tint-line)}
.tile .i{width:20px;height:20px}
.path h3{font-size:17px;font-weight:600;margin:18px 0 6px;line-height:1.45}
.path p{font-size:14px;line-height:1.7;color:var(--muted);margin:0}
.more{margin-top:18px;font-size:14px;font-weight:600;color:var(--accent);display:inline-flex;align-items:center;gap:6px}
.more .i{width:16px;height:16px}
.path .chev{display:none}
.kind{overflow:hidden}
.art{height:176px;background:var(--canvas);background-image:radial-gradient(var(--dot) 1px,transparent 1.3px);background-size:14px 14px;border-bottom:1px solid var(--line);position:relative;overflow:hidden}
.kind-b{padding:18px 22px 22px}
.kind h3{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;margin:0 0 6px}
.kind h3 .i{color:var(--accent)}
.kind p{font-size:14px;line-height:1.7;color:var(--muted);margin:0}
.foot{border-top:1px solid var(--line);padding:22px 0 28px;display:flex;align-items:center;justify-content:space-between;font-size:13.5px;color:var(--muted)}
.foot-l{display:flex;align-items:center;gap:10px}
.foot-l .logo{width:22px;height:22px;border-radius:6px}
.foot-r{display:flex;gap:22px}
.foot-r a{display:inline-flex;align-items:center;gap:6px}
.foot-r .i{width:15px;height:15px}

/* hero workbench illustration */
.wb{position:relative;width:540px;height:420px;border-radius:18px;background:var(--card);box-shadow:var(--sh-lg);overflow:hidden}
.wb-bar{height:46px;display:flex;align-items:center;gap:10px;padding:0 12px 0 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
.wb-bar .logo{width:20px;height:20px;border-radius:5px}
.wb-bar b{color:var(--ink);font-weight:600}
.wb-bar .sep{color:var(--line2)}
.wb-end{margin-left:auto;display:flex;align-items:center;gap:8px}
.av{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:650;flex-shrink:0}
.av-me{background:var(--tint);color:var(--accent);box-shadow:inset 0 0 0 1px var(--tint-line)}
.av-ai{background:var(--ink);color:var(--bg)}
.stack{display:flex}.stack .av{box-shadow:0 0 0 2px var(--card)}.stack .av+.av{margin-left:-6px}
.wb-share{height:28px;padding:0 10px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px}
.wb-share .i{width:13px;height:13px;stroke-width:2}
.wb-cv{position:absolute;inset:46px 0 0;background:var(--canvas);background-image:radial-gradient(var(--dot) 1px,transparent 1.3px);background-size:16px 16px}
.mb{position:absolute;width:176px;height:218px;background:#fffdf7;color:#3f382c;border-radius:4px;padding:14px;box-shadow:0 0 0 1px rgb(60 44 30 / .08),0 4px 10px -4px rgb(60 44 30 / .18),0 14px 28px -14px rgb(60 44 30 / .22)}
.mb-l{position:absolute;left:0;top:-22px;font-size:11.5px;color:var(--muted);white-space:nowrap;display:flex;gap:6px;align-items:center}
.mb-l b{font-weight:600;color:var(--ink2)}
.mb-a{left:28px;top:54px}
.mb-b{left:232px;top:54px;outline:1.5px solid var(--accent);outline-offset:3px}
.mb-b .mb-l{top:-26px;color:var(--accent)}.mb-b .mb-l b{color:var(--accent)}
.hd{position:absolute;width:8px;height:8px;background:var(--card);border:1.5px solid var(--accent);border-radius:2px}
.hd1{left:-8px;top:-8px}.hd2{right:-8px;top:-8px}.hd3{left:-8px;bottom:-8px}.hd4{right:-8px;bottom:-8px}
.mnav{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.08em}
.mnav i{display:flex;gap:4px}.mnav i s{display:block;width:14px;height:3px;border-radius:2px;background:#d8cdbb}
.mt{font-size:18px;font-weight:700;line-height:1.3;letter-spacing:-.01em;margin-top:16px}
.mc{font-size:8px;color:#8d826f;margin-top:6px}
.scn{position:relative;overflow:hidden;background:#efdcbf;height:68px;margin-top:12px;border-radius:2px}
.sun{position:absolute;width:26px;height:26px;border-radius:50%;background:#cf7a4f;right:24px;top:10px}
.hl{position:absolute;width:170px;height:130px;border-radius:46% 54% 0 0}
.hl1{background:#98a07f;top:34px;left:-40px;transform:rotate(-18deg)}
.hl2{background:#5d6f59;top:46px;left:62px;transform:rotate(22deg)}
.mcta{display:inline-block;margin-top:12px;font-size:8.5px;font-weight:600;color:#fff;background:#5d6f59;padding:4px 9px;border-radius:999px}
.mb-b .mt{margin-top:26px}
.pin{position:absolute;left:372px;top:98px;width:28px;height:28px;border-radius:50% 50% 50% 4px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-size:12px;font-weight:700;box-shadow:0 0 0 3px var(--card),0 6px 14px -4px rgb(180 81 47 / .55);z-index:3}
.cursor{position:absolute;left:398px;top:122px;z-index:4;color:var(--ink)}
.cursor .i{width:20px;height:20px;fill:var(--ink);stroke:var(--card);stroke-width:1.5}
.thread{position:absolute;left:276px;top:180px;width:246px;background:var(--card);border-radius:14px;box-shadow:var(--sh-md);padding:6px;z-index:5}
.msg{display:flex;gap:10px;padding:10px 10px}
.msg+.msg{box-shadow:inset 0 1px 0 var(--line)}
.msg-h{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);line-height:1.4}
.msg-h b{color:var(--ink);font-weight:600}
.msg p{margin:3px 0 0;font-size:13px;line-height:1.55;color:var(--ink)}
.done{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:var(--ok);background:var(--ok-tint);padding:1px 7px 1px 5px;border-radius:999px;margin-left:auto}
.done .i{width:12px;height:12px;stroke-width:2.25}
.tools{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:2px;padding:4px;background:var(--card);border-radius:11px;box-shadow:var(--sh-md);z-index:5}
.tools span{width:30px;height:30px;display:grid;place-items:center;border-radius:7px;color:var(--muted)}
.tools span.on{background:var(--tint);color:var(--accent)}
.tools .i{width:16px;height:16px}
.zoom{position:absolute;right:14px;bottom:20px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}

/* kind illustrations */
.ka-1,.ka-2,.ka-3{position:absolute;background:var(--card);border-radius:5px;box-shadow:0 0 0 1px rgb(37 34 30 / .07),0 6px 14px -8px rgb(37 34 30 / .25)}
.dark .ka-1,.dark .ka-2,.dark .ka-3{box-shadow:0 0 0 1px rgb(255 255 255 / .08),0 6px 14px -8px rgb(0 0 0 / .6)}
.ka-1{left:calc(50% - 132px);top:38px;width:76px;height:96px}
.ka-2{left:calc(50% - 38px);top:38px;width:76px;height:96px;outline:1.5px solid var(--accent);outline-offset:2px}
.ka-3{left:calc(50% + 56px);top:38px;width:76px;height:96px}
.ln{display:block;height:5px;border-radius:3px;background:var(--line2);margin:0 10px 6px}
.blk{display:block;height:36px;margin:10px 10px 8px;border-radius:3px;background:var(--bg2)}
.ka-2 .blk{background:var(--tint)}
.kpin{position:absolute;left:calc(50% + 24px);top:26px;width:22px;height:22px;border-radius:50% 50% 50% 3px;background:var(--accent);color:var(--on-accent);font-size:10.5px;font-weight:700;display:grid;place-items:center;box-shadow:0 0 0 2.5px var(--card)}
.kd{position:absolute;left:calc(50% - 116px);top:26px;width:176px;height:170px;background:var(--card);border-radius:6px;padding:16px 16px;box-shadow:0 0 0 1px rgb(37 34 30 / .07),0 8px 18px -10px rgb(37 34 30 / .25)}
.dark .kd,.dark .kh{box-shadow:0 0 0 1px rgb(255 255 255 / .08),0 8px 18px -10px rgb(0 0 0 / .6)}
.kd .ln{margin:0 0 8px}
.kd .h{height:8px;width:62%;background:var(--ink2);opacity:.75;margin-bottom:14px}
.mark{display:block;height:9px;margin:0 0 8px;border-radius:2px;background:var(--tint);box-shadow:inset 0 -2px 0 var(--accent);width:84%}
.bub{position:absolute;left:calc(50% + 34px);top:58px;width:96px;background:var(--card);border-radius:9px;padding:8px 9px;box-shadow:var(--sh-md);font-size:10.5px;line-height:1.45;color:var(--ink)}
.bub b{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);font-weight:500;margin-bottom:3px}
.bub .av{width:14px;height:14px;font-size:7.5px}
.kh{position:absolute;left:calc(50% - 120px);top:28px;width:240px;height:160px;background:var(--card);border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px rgb(37 34 30 / .07),0 8px 18px -10px rgb(37 34 30 / .25)}
.kh-bar{height:22px;display:flex;align-items:center;gap:4px;padding:0 8px;border-bottom:1px solid var(--line);background:var(--bg2)}
.kh-bar s{width:6px;height:6px;border-radius:50%;background:var(--line2)}
.kh-bar em{margin-left:8px;height:10px;flex:1;border-radius:3px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.kh-b{padding:14px 16px}
.kh-b .ln{margin:0 0 7px}
.kh-btn{display:inline-flex;margin-top:10px;height:22px;padding:0 10px;align-items:center;border-radius:6px;background:var(--accent);color:var(--on-accent);font-size:10px;font-weight:600}
.kh-cur{position:absolute;left:calc(50% - 40px);top:118px}
.kh-cur .i{width:17px;height:17px;fill:var(--ink);stroke:var(--card);stroke-width:1.5}
.kh-tag{position:absolute;right:calc(50% - 112px);top:34px;font-size:9.5px;font-weight:600;color:var(--ok);background:var(--ok-tint);padding:1px 6px;border-radius:999px}

/* docs */
.docs{display:grid;grid-template-columns:264px minmax(0,1fr) 236px;min-height:calc(100vh - 64px)}
.side{border-right:1px solid var(--line);padding:24px 16px 32px}
.sg{margin-bottom:20px}
.sg-t{font-size:13px;font-weight:600;color:var(--ink);padding:0 12px;margin-bottom:4px;line-height:1.9}
.side a{display:block;font-size:14px;color:var(--muted);padding:5px 12px;border-radius:8px;line-height:1.6}
.side a.on{background:var(--tint);color:var(--accent);font-weight:600}
.article{padding:40px 56px 64px;max-width:800px;min-width:0}
.crumb{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:4px}
.crumb .i{width:14px;height:14px;color:var(--line2)}
.crumb b{color:var(--ink2);font-weight:500}
.dh{font-size:36px;line-height:1.3;font-weight:700;letter-spacing:-.015em;margin:14px 0 12px}
.lead{text-wrap:pretty;font-size:17px;color:var(--ink2);line-height:1.8;margin:0}
.meta{display:flex;margin-top:26px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line);background:var(--card)}
.meta>div{flex:1;display:flex;align-items:center;gap:12px;padding:12px 16px}
.meta>div+div{box-shadow:inset 1px 0 0 var(--line)}
.meta .i{color:var(--muted)}
.meta small{display:block;font-size:12px;color:var(--muted);line-height:1.4}
.meta b{display:block;font-size:14px;font-weight:600;line-height:1.5}
.callout{display:flex;gap:12px;padding:14px 18px 14px 16px;border-radius:12px;background:var(--tint);box-shadow:inset 0 0 0 1px var(--tint-line);margin-top:24px}
.callout>.i{color:var(--accent);margin-top:3px}
.callout strong{display:block;font-size:14.5px;font-weight:600;line-height:1.6}
.callout p{margin:2px 0 0;font-size:14px;line-height:1.7;color:var(--ink2)}
.article h2{font-size:23px;line-height:1.4;font-weight:650;letter-spacing:-.01em;margin:48px 0 0}
.article>p,.step p{font-size:15px;line-height:1.85;color:var(--ink2);margin:12px 0 0}
.article code,.step code{font:13px ui-monospace,"SF Mono",Menlo,monospace;background:var(--bg2);box-shadow:inset 0 0 0 1px var(--line);padding:1px 6px;border-radius:5px;color:var(--ink)}
.steps{margin-top:28px}
.step{display:grid;grid-template-columns:32px minmax(0,1fr);gap:18px;position:relative;padding-bottom:34px}
.step::before{content:"";position:absolute;left:15.5px;top:40px;bottom:6px;width:1px;background:var(--line2)}
.step:last-child{padding-bottom:0}.step:last-child::before{display:none}
.sn{width:32px;height:32px;border-radius:50%;background:var(--card);box-shadow:inset 0 0 0 1px var(--line2),0 1px 2px rgb(37 34 30 / .06);display:grid;place-items:center;font-size:13.5px;font-weight:650;color:var(--accent);font-variant-numeric:tabular-nums}
.step h3{font-size:17.5px;font-weight:600;margin:2px 0 0;line-height:1.6}
.step p{margin-top:4px}
.codeb{margin-top:14px;border-radius:12px;background:var(--code);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.codeh{height:40px;display:flex;align-items:center;gap:8px;padding:0 6px 0 14px;font-size:12.5px;color:var(--muted);box-shadow:inset 0 -1px 0 var(--line)}
.codeh .i{width:15px;height:15px}
.copy{margin-left:auto;width:30px;height:30px;border-radius:7px;display:grid;place-items:center;color:var(--muted)}
.copy .i{width:16px;height:16px}
pre{margin:0;padding:14px 18px 16px;font:13px/1.9 ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.k{color:var(--accent);font-weight:600}.f{color:var(--muted)}
.choices{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:26px}
.choice{padding:18px 18px 18px;position:relative}
.choice .tile{width:36px;height:36px;border-radius:9px}
.choice .tile .i{width:18px;height:18px}
.choice h3{font-size:16px;font-weight:600;margin:14px 0 4px;line-height:1.5}
.choice p{font-size:14px;line-height:1.7;color:var(--muted);margin:0}
.choice>.go{position:absolute;right:16px;top:18px;color:var(--muted)}
.choice>.go .i{width:17px;height:17px}
.pager{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:56px}
.pg{padding:14px 18px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line)}
.pg small{display:block;font-size:12.5px;color:var(--muted)}
.pg b{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:600;margin-top:2px}
.pg b .i{width:16px;height:16px;color:var(--muted)}
.pg.next{text-align:right}.pg.next b{justify-content:flex-end}
.toc{padding:44px 28px 0 4px;font-size:13.5px}
.toc-t{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:10px}
.toc-t .i{width:16px;height:16px;color:var(--muted)}
.toc a{display:block;color:var(--muted);padding:5px 0 5px 14px;box-shadow:inset 1px 0 0 var(--line);line-height:1.55}
.toc a.on{color:var(--accent);box-shadow:inset 2px 0 0 var(--accent);font-weight:550}
.toc-f{margin-top:24px;padding-top:16px;box-shadow:inset 0 1px 0 var(--line)}
.toc-f a{box-shadow:none;padding:0;display:inline-flex;align-items:center;gap:7px;color:var(--muted)}
.toc-f .i{width:15px;height:15px}
.pagebar{display:none}

/* use case */
.case{max-width:1120px;margin:0 auto;padding:44px 40px 56px}
.case .dh{font-size:40px;margin-top:14px}
.case .lead{max-width:40em}
.flow{display:flex;align-items:center;margin-top:28px}
.fs{display:flex;align-items:center;gap:10px;font-size:14.5px;font-weight:550;color:var(--ink)}
.fs span{width:26px;height:26px;border-radius:50%;background:var(--tint);color:var(--accent);box-shadow:inset 0 0 0 1px var(--tint-line);display:grid;place-items:center;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums}
.fl{width:56px;height:1px;background:var(--line2);margin:0 16px}
.figs{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:40px}
.fig{margin:0;overflow:hidden;border-radius:18px}
.fig-h{padding:22px 24px 18px}
.step-tag{font-size:13px;font-weight:600;color:var(--accent)}
.fig h2{font-size:19px;font-weight:650;margin:4px 0 6px;line-height:1.45}
.fig-h p{font-size:14.5px;line-height:1.75;color:var(--muted);margin:0}
.shot{margin:0 12px;border-radius:6px;overflow:hidden;aspect-ratio:1.22;background:var(--bg2)}
.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top left;outline:1px solid var(--img-outline);outline-offset:-1px;border-radius:6px}
.fig figcaption{padding:12px 24px 18px;font-size:13px;line-height:1.6;color:var(--muted)}
.note{margin-top:28px;display:flex;align-items:center;gap:14px;padding:16px 16px 16px 20px;border-radius:14px;background:var(--bg2);box-shadow:inset 0 0 0 1px var(--line)}
.note>.i{color:var(--muted)}
.note p{flex:1;margin:0;font-size:14px;line-height:1.7;color:var(--ink2)}

/* phone */
.m .top{height:56px;padding:0 8px 0 16px;gap:10px}
.m .nav,.m .desk{display:none}
.m .mob{display:flex}
.m .top-end{gap:0}
.m .home{padding:0 20px}
.m .hero{display:block;padding:40px 0 56px}
.m .display{font-size:34px;line-height:1.3}
.m .hero-copy{font-size:15.5px;margin-top:16px}
.m .cta{flex-direction:column;gap:10px;margin-top:28px}
.m .wb-fit{height:271px;margin-top:40px}
.m .wb-fit .wb{transform:scale(.6481);transform-origin:top left}
.m .sec{padding-bottom:52px}
.m .sec-h{font-size:20px;margin-bottom:16px}
.m .grid3{grid-template-columns:1fr;gap:12px}
.m .path{display:grid;grid-template-columns:40px minmax(0,1fr) 18px;column-gap:14px;align-items:center;padding:16px}
.m .path h3{margin:0;font-size:16px}
.m .path p{font-size:13.5px;grid-column:2}
.m .path .tile{grid-row:span 2}
.m .path .more{display:none}
.m .path .chev{display:block;grid-row:1 / span 2;grid-column:3;color:var(--line2)}
.m .art{display:none}
.m .kind-b{padding:16px}
.m .kind h3 .i{width:18px;height:18px}
.m .kind p{font-size:13.5px}
.m .foot{flex-direction:column;align-items:flex-start;gap:14px}
.m .docs{display:block;min-height:0}
.m .side,.m .toc{display:none}
.m .pagebar{display:flex;height:48px;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line);font-size:14px;color:var(--ink2)}
.m .pagebar span{display:inline-flex;align-items:center;gap:8px}
.m .pagebar .i{width:17px;height:17px;color:var(--muted)}
.m .article{padding:24px 20px 44px}
.m .dh{font-size:29px;margin-top:12px}
.m .lead{font-size:15.5px}
.m .choices{grid-template-columns:1fr;gap:10px}
.m .article h2{font-size:20px;margin-top:40px}
.m .step{gap:14px;padding-bottom:28px}
.m .step h3{font-size:16.5px}
.m .callout{padding:14px}
.m .pager{gap:10px;margin-top:44px}
.m .pg{padding:12px 14px}.m .pg b{font-size:14px}
.m .case{padding:24px 20px 44px}
.m .case .dh{font-size:30px}
.m .flow{flex-direction:column;align-items:flex-start;gap:0;margin-top:24px}
.m .fl{width:1px;height:14px;margin:4px 0 4px 12.5px}
.m .figs{grid-template-columns:1fr;gap:16px;margin-top:28px}
.m .fig-h{padding:18px 18px 14px}
.m .fig h2{font-size:17.5px}
.m .shot{margin:0 10px}
.m .fig figcaption{padding:10px 18px 16px}
.m .note{flex-direction:column;align-items:flex-start;padding:16px}
"""


def header(dark=False, active="guide", mobile=False):
    theme = "moon" if dark else "sun"
    nav = "".join(
        f'<a class="{"on" if k == active else ""}">{v}</a>'
        for k, v in [("guide", "使用指南"), ("host", "自托管"), ("cases", "使用案例")]
    )
    return (
        f'<header class="top"><a class="brand">{LOGO}案间<span class="chip">文档</span></a>'
        f'<nav class="nav">{nav}</nav>'
        f'<div class="top-end">'
        f'<div class="search desk">{i("search")}搜索文档<kbd>⌘K</kbd></div>'
        f'<span class="ib desk" role="img" aria-label="切换主题">{i(theme)}</span>'
        f'<span class="ib desk" role="img" aria-label="GitHub 仓库">{i("github")}</span>'
        f'<span class="ib mob" role="img" aria-label="搜索文档">{i("search")}</span>'
        f'<span class="ib mob" role="img" aria-label="导航菜单">{i("menu")}</span>'
        f'</div></header>'
    )


def page(title, body_cls, body):
    return (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{title} · 案间文档站设计稿</title><style>{CSS}</style></head>'
        f'<body class="{body_cls}">{body}</body></html>\n'
    )


def workbench():
    mini = lambda title, cap: (
        f'<div class="mnav">山野<i><s></s><s></s></i></div><div class="mt">{title}</div>'
        f'<div class="mc">{cap}</div>'
        '<div class="scn"><div class="sun"></div><div class="hl hl1"></div><div class="hl hl2"></div></div>'
        '<span class="mcta">开始探索</span>'
    )
    return (
        '<div class="wb" role="img" aria-label="案间画板示意：山野旅行首页的两个方案并排，方案 B 被选中；'
        '你在标题处批注“再多留一点空间”，Agent 回复已修改。示意图，不是产品截图。">'
        f'<div class="wb-bar">{LOGO}<span>山野旅行</span><span class="sep">/</span><b>首页探索</b>'
        '<div class="wb-end"><span class="stack"><span class="av av-me">你</span><span class="av av-ai">AI</span></span>'
        f'<span class="wb-share">{i("share")}分享</span></div></div>'
        '<div class="wb-cv">'
        f'<div class="mb mb-a"><span class="mb-l"><b>方案 A</b>满幅插画</span>{mini("去山里，<br>找回节奏。", "Walk slowly, see more.")}</div>'
        '<div class="mb mb-b"><span class="mb-l"><b>方案 B</b>已选择</span>'
        '<i class="hd hd1"></i><i class="hd hd2"></i><i class="hd hd3"></i><i class="hd hd4"></i>'
        f'{mini("把日常<br>留在山脚。", "向山而行，慢一点也没关系。")}</div>'
        f'<span class="pin">1</span><span class="cursor">{i("ptr")}</span>'
        '<div class="thread">'
        '<div class="msg"><span class="av av-me">你</span><div style="flex:1"><div class="msg-h"><b>你</b>刚刚</div>'
        '<p>选 B，标题再多留一点空间。</p></div></div>'
        '<div class="msg"><span class="av av-ai">AI</span><div style="flex:1"><div class="msg-h"><b>Agent</b>'
        f'<span class="done">{i("check")}已修改</span></div><p>标题间距已加到 26px。</p></div></div>'
        '</div>'
        f'<div class="tools"><span>{i("ptr")}</span><span>{i("hand")}</span><span class="on">{i("msg")}</span></div>'
        '<span class="zoom">75%</span>'
        '</div></div>'
    )


def home(dark=False, mobile=False):
    cls = " ".join(c for c in ["dark" if dark else "", "m" if mobile else ""] if c)
    paths = [
        ("laptop", "在自己的电脑上开始", "构建并启动案间，创建第一份作品。", "本机使用指南"),
        ("link", "发个链接，让朋友看看", "创建公开快照，对方无需登录即可查看。", "公开分享"),
        ("users", "给朋友一个独立空间", "通过 GitHub 邀请，让朋友管理自己的作品。", "邀请朋友"),
    ]
    path_html = "".join(
        f'<a class="card path"><span class="tile">{i(ic)}</span><h3>{t}</h3><p>{d}</p>'
        f'<span class="more">{m}{i("right")}</span><span class="chev">{i("chev")}</span></a>'
        for ic, t, d, m in paths
    )
    kinds = [
        ("board", "画板", "多个方案并排比较，批注落到具体元素。",
         '<div class="ka-1"><span class="blk"></span><span class="ln"></span><span class="ln" style="width:50%"></span></div>'
         '<div class="ka-2"><span class="blk"></span><span class="ln"></span><span class="ln" style="width:50%"></span></div>'
         '<div class="ka-3"><span class="blk"></span><span class="ln"></span><span class="ln" style="width:50%"></span></div>'
         '<span class="kpin">1</span>'),
        ("doc", "文档", "选中文字批注，也能直接改字、对比历史。",
         '<div class="kd"><span class="ln h"></span><span class="ln"></span><span class="ln" style="width:88%"></span>'
         '<span class="mark"></span><span class="ln" style="width:70%"></span><span class="ln"></span><span class="ln" style="width:56%"></span></div>'
         '<div class="bub"><b><span class="av av-me">你</span>批注</b>这句换个说法？</div>'),
        ("code", "HTML 预览", "在隔离环境里试用页面交互，再提交反馈。",
         '<div class="kh"><div class="kh-bar"><s></s><s></s><s></s><em></em></div>'
         '<div class="kh-b"><span class="ln h" style="height:8px;width:50%;background:var(--ink2);opacity:.75;margin-bottom:12px"></span>'
         '<span class="ln"></span><span class="ln" style="width:72%"></span><span class="kh-btn">预约</span></div></div>'
         '<span class="kh-tag">可交互</span>'
         f'<span class="kh-cur">{i("ptr")}</span>'),
    ]
    kind_html = "".join(
        f'<div class="card kind"><div class="art" aria-hidden="true">{art}</div><div class="kind-b">'
        f'<h3>{i(ic)}{t}</h3><p>{d}</p></div></div>'
        for ic, t, d, art in kinds
    )
    show = f'<div class="wb-fit">{workbench()}</div>' if mobile else workbench()
    br = "" if mobile else "<br>"
    body = (
        header(dark, mobile=mobile)
        + '<div class="home-bg"><main class="home">'
        + '<section class="hero"><div>'
        + '<h1 class="display">把想法摆出来，<br>让讨论有个<em>落点。</em></h1>'
        + f'<p class="hero-copy">画板里比较方案，文档上留下批注，HTML 中试用原型。{br}和你的 Agent 一起，把反馈变成下一版作品。</p>'
        + f'<div class="cta"><a class="btn btn-primary">开始本机使用{i("right")}</a><a class="btn btn-ghost">了解全部功能</a></div>'
        + f'</div>{show}</section>'
        + f'<section class="sec"><h2 class="sec-h">你想从哪里开始？</h2><div class="grid3">{path_html}</div></section>'
        + f'<section class="sec"><h2 class="sec-h">三种作品，同一套批注</h2><div class="grid3">{kind_html}</div></section>'
        + f'<footer class="foot"><span class="foot-l">{LOGO}案间 · AGPL-3.0 开源</span>'
        + f'<span class="foot-r"><a>{i("github", "i")}GitHub</a><a>开源与许可{i("out")}</a></span></footer>'
        + '</main></div>'
    )
    return body, cls


SIDEBAR = [
    ("开始使用", ["认识案间", "在本机使用", "创建第一份作品"]),
    ("作品与反馈", ["画板", "文档", "HTML 预览", "批注与 Agent"]),
    ("分享与协作", ["公开分享", "邀请朋友", "设备与 CLI"]),
    ("管理与部署", ["作品库与回收站", "存储与备份", "部署自己的实例", "常见问题"]),
]


def docs_shell(active, crumb, toc, toc_on, article, mobile):
    side = "".join(
        f'<div class="sg"><div class="sg-t">{g}</div>'
        + "".join(f'<a class="{"on" if it == active else ""}">{it}</a>' for it in items)
        + "</div>"
        for g, items in SIDEBAR
    )
    toc_html = "".join(f'<a class="{"on" if n == toc_on else ""}">{t}</a>' for n, t in enumerate(toc))
    crumb_html = f' {i("chev")} '.join(crumb[:-1]) + f' {i("chev")} <b>{crumb[-1]}</b>'
    return (
        header(mobile=mobile)
        + f'<div class="pagebar"><span>{i("menu")}文档导航</span><span>本页目录{i("down")}</span></div>'
        + f'<div class="docs"><aside class="side">{side}</aside>'
        + f'<main class="article"><div class="crumb">{crumb_html}</div>{article}</main>'
        + f'<aside class="toc"><div class="toc-t">{i("toc")}本页内容</div>{toc_html}'
        + f'<div class="toc-f"><a>{i("github")}发现错误？在 GitHub 反馈</a></div></aside></div>'
    )


def pager(prev, nxt):
    return (
        f'<nav class="pager"><a class="pg"><small>上一篇</small><b>{i("left")}{prev}</b></a>'
        f'<a class="pg next"><small>下一篇</small><b>{nxt}{i("right")}</b></a></nav>'
    )


def code(title, lines):
    return (
        f'<div class="codeb"><div class="codeh">{i("term")}{title}'
        f'<span class="copy" role="img" aria-label="复制">{i("copy")}</span></div><pre>{lines}</pre></div>'
    )


def local(mobile=False):
    art = (
        '<h1 class="dh">在本机使用</h1>'
        '<p class="lead">让作品留在自己的电脑里。完成构建后，在浏览器打开案间，再让 Agent 为你创建第一份作品。</p>'
        '<div class="meta">'
        f'<div>{i("pkg")}<span><small>运行环境</small><b class="num-t">Node.js 22</b></span></div>'
        f'<div>{i("pkg")}<span><small>包管理器</small><b class="num-t">pnpm 10.28.2</b></span></div>'
        f'<div>{i("branch")}<span><small>安装方式</small><b>从源码构建</b></span></div></div>'
        f'<div class="callout">{i("info")}<div><strong>开始前</strong>'
        '<p>案间尚未发布 npm 安装包。请使用本项目源码，不要安装上游 Ryugi 包或同名的未知软件包。</p></div></div>'
        '<div class="steps">'
        '<div class="step"><span class="sn">1</span><div><h3>获取源码并构建</h3>'
        '<p>在终端进入案间仓库，安装依赖并生成本地应用。</p>'
        + code("终端 · 仓库根目录",
               '<span class="k">git</span> clone https://github.com/yusixian/anjian.git\n'
               '<span class="k">cd</span> anjian/artifacts\n'
               '<span class="k">pnpm</span> install <span class="f">--frozen-lockfile</span>\n'
               '<span class="k">pnpm</span> build')
        + '</div></div>'
        '<div class="step"><span class="sn">2</span><div><h3>启动你的作品项目</h3>'
        '<p>把路径换成存放作品的项目目录，保持这个终端运行。</p>'
        + code("终端 · artifacts 目录",
               '<span class="k">node</span> dist/cli.cjs start \\\n'
               '  <span class="f">--project-dir</span> /绝对路径/作品项目 \\\n'
               '  <span class="f">--no-open --foreground</span>')
        + '</div></div>'
        '<div class="step"><span class="sn">3</span><div><h3>打开浏览器，开始创作</h3>'
        '<p>打开终端输出的完整网址。作品保存在项目的 <code>.anjian/artifacts/</code> 中，退出服务不会删除作品。'
        '接着把 Artifacts 技能交给你的 Agent，创建第一份画板或文档。</p></div></div>'
        '</div>'
        + pager("认识案间", "创建第一份作品")
    )
    return docs_shell("在本机使用", ["使用指南", "开始使用", "在本机使用"],
                      ["获取源码并构建", "启动作品项目", "打开浏览器", "接下来"], 0, art, mobile)


def invite(mobile=False):
    art = (
        '<h1 class="dh">邀请朋友</h1>'
        '<p class="lead">朋友想自己创作时，为他开通独立空间。只想展示一份作品，直接用公开分享就够了。</p>'
        '<div class="choices">'
        f'<a class="card choice"><span class="tile">{i("link")}</span>'
        '<h3>只给朋友看作品</h3><p>发送公开链接，无需登录，只能查看已发布的快照。</p></a>'
        f'<a class="card choice"><span class="tile">{i("users")}</span>'
        '<h3>让朋友也来使用</h3><p>发送 GitHub 账号专属邀请，登录后管理自己的作品。</p></a>'
        '</div>'
        f'<div class="callout">{i("info")}<div><strong>由实例管理员发起邀请</strong>'
        '<p>需要可访问的自托管实例，并已配置 GitHub 登录。本机 localhost 地址无法发给远方的朋友使用。</p></div></div>'
        '<h2>管理员：创建邀请</h2>'
        '<div class="steps">'
        '<div class="step"><span class="sn">1</span><div><h3>先确认共享容量</h3>'
        '<p>进入「存储设置 → 实例共享」，设置总容量。成员额度是共享容量内的个人上限。</p></div></div>'
        '<div class="step"><span class="sn">2</span><div><h3>填写朋友的 GitHub 用户名</h3>'
        '<p>在「成员管理」点击「邀请朋友」，填写用户名和共享容量额度。</p></div></div>'
        '<div class="step"><span class="sn">3</span><div><h3>复制邀请链接，发给这位朋友</h3>'
        '<p>链接只在创建时显示，7 天有效，只能接受一次。过期或丢失后可以撤销并重新邀请。</p></div></div>'
        '</div>'
        '<h2>朋友：接受邀请并开始使用</h2>'
        '<p>打开邀请链接，用被邀请的 GitHub 账号登录。接受后进入自己的空间，拥有独立的作品与设备，看不到管理员的私有作品。</p>'
        '<p>要让本地 Agent 上传作品，再到「设备与 CLI」完成配对。日常浏览作品不需要重复配对。</p>'
        + pager("公开分享", "设备与 CLI")
    )
    return docs_shell("邀请朋友", ["使用指南", "分享与协作", "邀请朋友"],
                      ["选择分享方式", "管理员：创建邀请", "朋友：接受邀请"], 0, art, mobile)


def case(mobile=False):
    figs = [
        ("第 1 步", "在画板上，指出问题", "图标太小、文字太多，或者展示需要调整，直接在对应位置批注，意见和设计放在一起。",
         "artboard-comments.png", "文档站画板右侧列出四条批注，分别指向搜索图标、顶栏图标、冗余文字和首页展示。",
         "案间工作台 · 修改前的设计稿与四条具体反馈"),
        ("第 2 步", "回到会话，交给 Agent", "把作品链接发给已接入案间的 Agent，请它读取全部批注。修改后回到同一份作品继续检查。",
         "agent-feedback.png", "Lody 会话中，用户发送案间画板链接并要求处理评论，Agent 开始读取批注。",
         "Lody 会话 · Agent 开始读取评论。评论不会自动唤醒会话。"),
    ]
    fig_html = "".join(
        f'<figure class="card fig"><div class="fig-h"><span class="step-tag">{tag}</span><h2>{t}</h2><p>{d}</p></div>'
        f'<div class="shot"><img src="{src}" alt="{alt}"></div><figcaption>{cap}</figcaption></figure>'
        for tag, t, d, src, alt, cap in figs
    )
    flow = '<span class="fl"></span>'.join(
        f'<span class="fs"><span>{n}</span>{t}</span>'
        for n, t in [(1, "查看设计稿"), (2, "在画板批注"), (3, "让 Agent 修改")]
    )
    body = (
        header(active="cases", mobile=mobile)
        + '<main class="case">'
        + f'<div class="crumb">使用指南 {i("chev")} <b>使用案例</b></div>'
        + '<h1 class="dh">让设计反馈，落在具体位置。</h1>'
        + '<p class="lead">这份文档站就是一个例子：先在案间看设计稿，圈出想改的地方，再让 Agent 读取批注、修改作品。讨论和修改始终围绕同一份画板。</p>'
        + f'<div class="flow">{flow}</div>'
        + f'<div class="figs">{fig_html}</div>'
        + f'<div class="note">{i("info")}<p>截图记录的是实际过程，不代表验收完成。公开作品是只读快照，草稿修改不会自动更新公开版本。</p>'
        + f'<a class="btn btn-ghost btn-sm" href="https://anjian.cosine.ren/s/eTPVcN0J7yUd7-a1Gu9fv0FSsKRP3b7fUGoGqyfKfzA">查看公开作品{i("out")}</a></div>'
        + '</main>'
    )
    return body


BOARDS = {
    "docs-home-light": ("首页 · 浅色", lambda: home()),
    "docs-home-dark": ("首页 · 深色", lambda: home(dark=True)),
    "docs-home-mobile": ("手机 · 首页", lambda: home(mobile=True)),
    "docs-local": ("阅读页 · 本机使用", lambda: (local(), "")),
    "docs-invite": ("阅读页 · 邀请朋友", lambda: (invite(), "")),
    "docs-invite-mobile": ("手机 · 邀请朋友", lambda: (invite(mobile=True), "m")),
    "docs-case-desktop": ("使用案例 · 桌面", lambda: (case(), "")),
    "docs-case-mobile": ("使用案例 · 手机", lambda: (case(mobile=True), "m")),
}

for bid, (title, fn) in BOARDS.items():
    body, cls = fn()
    if "dark" in cls.split():
        body = body.replace(LOGO, LOGO_DARK)
    (OUT / f"{bid}.html").write_text(page(title, cls, body), encoding="utf-8")
    print("wrote", bid)
