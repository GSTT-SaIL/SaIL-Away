# Makes the browser-tab icons (assets/favicon.ico, favicon-32.png,
# apple-touch-icon.png) from the banner logo: its mark (the leftmost shape in
# assets/sail-centre-logo.png - the diamond) filled with the banner's first
# colour (--banner in css/base.css, #A81765) on a transparent background -
# the user's call, 2026-10-04. The home-screen icon (apple-touch) puts it on
# white, as iOS shows transparency as black. Re-run after changing the logo
# or colour - a department's own copy of the board gets its own icon this way. Needs Pillow; with
# Docker and nothing else installed, from the repo root:
#   docker run --rm -v "$PWD":/work python:3.12-slim sh -c "pip install -q pillow && python /work/tools/make-icons.py"
from PIL import Image
logo = Image.open("/work/assets/sail-centre-logo.png").convert("RGBA")
W, H = logo.size
a = logo.split()[3]
# The mark is the leftmost blob: columns with ink, up to the first fully clear gap.
cols = [any(a.getpixel((x, y)) > 20 for y in range(H)) for x in range(W)]
x0 = cols.index(True); x1 = x0
while x1 < W and cols[x1]: x1 += 1
mark = logo.crop((x0, 0, x1, H))
bb = mark.split()[3].point(lambda v: 255 if v > 20 else 0).getbbox()
mark = mark.crop(bb)
print("logo", logo.size, "mark columns", x0, x1, "mark size", mark.size)

COLOUR = (0xA8, 0x17, 0x65, 255)

def icon(size, pad=0.03, background=None):
    S = size * 4                                    # draw big, scale down: smooth edges
    out = Image.new("RGBA", (S, S), background or (0, 0, 0, 0))
    box = int(S * (1 - 2 * pad))
    k = box / max(mark.size)                        # scale up or down to fill the box
    m = mark.resize((round(mark.width * k), round(mark.height * k)), Image.LANCZOS)
    # The mark's own shape (its alpha), filled with the colour.
    filled = Image.new("RGBA", m.size, COLOUR)
    filled.putalpha(m.split()[3])
    out.alpha_composite(filled, ((S - m.width) // 2, (S - m.height) // 2))
    return out.resize((size, size), Image.LANCZOS)

icon(32).save("/work/assets/favicon-32.png")
icon(180, pad=0.14, background=(255, 255, 255, 255)).save("/work/assets/apple-touch-icon.png")   # iOS rounds the corners itself
ico = icon(256)
ico.save("/work/assets/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
