# Code Standards (ArabiForm)

Adapted from `yetone/magpie/docs/code-standards.md` + lessons already proven in `ImportMedic` M1 & M1.5.

| Rule | What Reviewer Checks |
| --- | --- |
| **Check XFA / Encryption / Signatures BEFORE `getForm()`** | `pdf-lib`'s `getForm()` can strip `/XFA` silently. Always inspect PDF catalog/AcroForm dictionary directly at intake and fail-closed with a clear user message. |
| **True Ink BBox Baseline (Zero Silent Arabic Clipping)** | Never place Arabic text using naive `fontSize * 0.2` heuristics. Shape via `fontkit`, sum exact glyph advances, `xyOffset`, and true ink `yMin`/`yMax` (including harakat & descenders), verify fit against inner rect minus border/padding, and flag anything below `minFontSize`. |
| **Canonical Field Multi-Widget Atomicity** | A single PDF field can have multiple widgets across pages (including `/Rotate 90/180/270` pages). Lay out EVERY widget independently; if ANY widget fails bounds, flag the whole field rather than partially writing half the pages. |
| **Strict Text Preservation for Leading Zeros** | Parse CSV and Excel ID/code columns without numeric coercion (`00123` MUST stay `"00123"`). Never convert string IDs through `Number()`. |
| **Untouched Field Invariance** | Unmapped fields retain exact original `/V` and `/AP` streams. Tests must include a populated unmapped sentinel field (e.g. `KEEP 00109`) and verify byte/value preservation. |
| **Zero External Runtime Requests** | Bundle all fonts, `pdf.js` worker, and sample fixtures locally. Zero Google Fonts, zero analytics beacons, zero network calls during processing; verified in Playwright network listener and `dist/_headers` CSP `connect-src 'none'`. |
| **Atomic Scope + Sibling Grep** | Fixes for one input format (CSV vs XLSX) or one output mode (ZIP vs Merged PDF) must grep and check the sibling path in the same change. |
| **Real Environment Red -> Green** | Every layout/PDF bug fix adds a failing fixture + PyMuPDF visual/readback test before marking green. Full suite (`typecheck + test + build + test:e2e`) must pass on `main`. |
