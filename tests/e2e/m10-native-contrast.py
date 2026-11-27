"""Measure repeated solid pixels of native controls against their actual adjacent background."""
import base64
from collections import Counter
import json
import sys

import fitz


def luminance(rgb):
    values = [v / 255 for v in rgb[:3]]
    return sum(w * (v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4)
               for v, w in zip(values, [.2126, .7152, .0722]))


ratios = []
for item in json.load(sys.stdin):
    image = fitz.Pixmap(base64.b64decode(item["png"]))
    assert image.colorspace.n == 3
    pixels = image.samples
    counts = Counter(zip(*(pixels[i::image.n] for i in range(image.n))))
    bg = luminance(item["background"])
    values = [luminance([rgb[i] + (1 - rgb[3] / 255) * item["background"][i] for i in range(3)]
                        if image.alpha else rgb) for rgb, count in counts.items() if count >= 3]
    ratios.append(max((max(v, bg) + .05) / (min(v, bg) + .05) for v in values))
print(json.dumps(ratios))
