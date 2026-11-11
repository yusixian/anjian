"""Final Anjian logo (C2 · 三层作品). Single source for boards and handoff assets.

Geometry is on a 64×64 grid. Layers are offset by (6.5, -6.5):
  back  x23   y7    31×37 r6.5
  mid   x16.5 y13.5 31×37 r6.5
  front x10   y20   31×37 r6.5
  pin   circle (24.5, 40.5) r6.5 with a square bottom-left corner
"""

BACK = '<rect x="23" y="7" width="31" height="37" rx="6.5"/>'
MID_RECT = 'x="16.5" y="13.5" width="31" height="37" rx="6.5"'
FRONT_RECT = 'x="10" y="20" width="31" height="37" rx="6.5"'
PIN = "M18 47v-6.5a6.5 6.5 0 1 1 6.5 6.5H19a1 1 0 0 1-1-1Z"

# Solid colors = terracotta at 26% / 55% over the tile, precomputed so layers never darken where they overlap.
LIGHT = {"tile": "#f6efe6", "back": "#e5c6b6", "mid": "#d29881", "front": "#b4512f"}
# Dark layers use 34% / 62% so the back layer stays visible on the dark tile.
DARK = {"tile": "#2a2521", "back": "#6c4d40", "mid": "#a36e5a", "front": "#ed9b7d"}


def color_body(c=LIGHT, pin=None):
    """Full-color mark (no tile). `pin` is the fill of the comment pin: the surface behind the mark."""
    return (f'<rect x="23" y="7" width="31" height="37" rx="6.5" fill="{c["back"]}"/>'
            f'<rect {MID_RECT} fill="{c["mid"]}"/>'
            f'<rect {FRONT_RECT} fill="{c["front"]}"/>'
            f'<path d="{PIN}" fill="{pin or c["tile"]}"/>')


def tile_body(c=LIGHT):
    """App icon / favicon: mark at 80% on a rounded tile."""
    return (f'<rect width="64" height="64" rx="15" fill="{c["tile"]}"/>'
            f'<g transform="translate(6.4 6.4) scale(.8)">{color_body(c)}</g>')


def mono_body(uid="anjian-mark"):
    """Single-color mark using currentColor; transparent pin. `uid` must be unique per document."""
    return (f'<defs><mask id="{uid}-pin" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            f'<rect width="64" height="64" fill="#fff"/><path d="{PIN}" fill="#000"/></mask>'
            f'<mask id="{uid}-back" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            f'<rect width="64" height="64" fill="#fff"/><rect {MID_RECT} fill="#000"/></mask></defs>'
            f'<g mask="url(#{uid}-pin)" fill="currentColor">'
            f'<rect x="23" y="7" width="31" height="37" rx="6.5" opacity=".26" mask="url(#{uid}-back)"/>'
            f'<rect {MID_RECT} opacity=".55"/><rect {FRONT_RECT}/></g>')


def svg_file(body, size=64):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}">{body}</svg>\n'
