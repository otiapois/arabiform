"""Compare the actual rendered serial's first glyphs before/after activating its overlay."""
import json
import sys

import fitz

inactive, active = (fitz.Pixmap(path) for path in sys.argv[1:])
assert (inactive.width, inactive.height, inactive.n) == (active.width, active.height, active.n)
width, height, n = inactive.width, inactive.height, inactive.n
before, after = inactive.samples, active.samples
ink = 0
hidden = []
# The Workshop Title is a single line of Latin text. Exclude horizontal borders
# and sample the first characters where the page's own ink meets the overlay.
for y in range(height // 3, (2 * height + 2) // 3):
    for x in range(1, min(width // 2, 32)):
        offset = (y * width + x) * n
        original = max(before[offset:offset + 3])
        selected = max(after[offset:offset + 3])
        if original >= 205:
            continue
        ink += 1
        if selected >= 225 and selected - original > 35:
            hidden.append((x, y))
assert ink > 2, ("no underlying serial glyphs sampled", ink)
evidence = {"width": width, "height": height, "sampledInk": ink, "hiddenInkPixels": len(hidden), "locations": hidden}
print(json.dumps(evidence))
assert not hidden, evidence
