"""Pixel comparison of two screenshot folders from e2e/shots.spec.ts: python3 e2e/compare-shots.py <before> <after> [<diff-out-dir>].
Reports, per screen, whether the size is the same and how many pixels differ (a small tolerance absorbs anti-aliasing)."""
import os, sys
from PIL import Image, ImageChops

a, b = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else None
TOL = 24  # per channel, out of 255
if out: os.makedirs(out, exist_ok=True)
bad = 0
for name in sorted(os.listdir(a)):
    pa, pb = os.path.join(a, name), os.path.join(b, name)
    if not os.path.exists(pb): print(f"{name:34} MISSING in {b}"); bad += 1; continue
    ia, ib = Image.open(pa).convert("RGB"), Image.open(pb).convert("RGB")
    if ia.size != ib.size:
        print(f"{name:34} SIZE {ia.size} -> {ib.size}"); bad += 1; continue
    d = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v > TOL else 0)
    n = sum(1 for v in d.getdata() if v)
    box = d.getbbox()
    pct = 100 * n / (ia.size[0] * ia.size[1])
    flag = "same" if n == 0 else f"{n} px ({pct:.2f}%) in {box}"
    print(f"{name:34} {ia.size[0]}x{ia.size[1]:<6} {flag}")
    if n:
        bad += 1
        if out: Image.merge("RGB", (ia.convert("L"), ib.convert("L"), ib.convert("L"))).save(os.path.join(out, name))
print("\n%d of %d screens differ" % (bad, len(os.listdir(a))))
