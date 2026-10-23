#!/usr/bin/env python3
"""Cut a generated icon sheet (badges on a light background) into single square icons.
usage: slice-grid.py <sheet.png> <out-dir> <name1,name2,...> [--size 256] [--region x0,y0,x1,y1]
Finds the badges by projecting 'not background' pixels onto each axis and splitting on background gaps."""
import sys, os, numpy as np
from PIL import Image
src, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
size = int(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 256
im = Image.open(src).convert('RGB')
if '--region' in sys.argv:
    im = im.crop(tuple(int(v) for v in sys.argv[sys.argv.index('--region') + 1].split(',')))
a = np.asarray(im).astype(int)
bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)]), axis=0)
fg = (np.abs(a - bg).sum(axis=2) > 60)
def spans(profile, min_len):
    on = profile > profile.max() * 0.25; res = []; i = 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and on[j]: j += 1
            if j - i >= min_len: res.append((i, j))
            i = j
        else: i += 1
    return res
rows = spans(fg.sum(axis=1), a.shape[0] // 12)
cols = spans(fg.sum(axis=0), a.shape[1] // 12)
os.makedirs(out, exist_ok=True)
k = 0
for (y0, y1) in rows:
    for (x0, x1) in cols:
        if k >= len(names): break
        tile = im.crop((x0, y0, x1, y1)).resize((size, size), Image.LANCZOS)
        tile.save(os.path.join(out, names[k] + '.png')); k += 1
print(f'{len(rows)} rows x {len(cols)} cols found, wrote {k} icons to {out}')
