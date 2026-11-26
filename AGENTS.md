# AGENTS.md — ArabiForm (Browser-Local Arabic & Unicode AcroForm Batch PDF Studio)

> Architectural governance adapted from `yetone/magpie`'s 3-Loop + `LESSONS.md` + real-environment verification model.
> **Project Manager & Final Acceptor**: Antigravity / Gemini (owns product strategy, milestone specs, subsystem contracts, and independent final acceptance).
> **Lead Executor**: Codex CLI (`gpt-6.2-sol` + multi-agent teams + isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`).

## 1. Mandatory Pre-Change Read Order
1. Read [docs/subsystems/README.md](docs/subsystems/README.md) and the owning subsystem contract.
2. Read [docs/code-standards.md](docs/code-standards.md).
3. Read [LESSONS.md](LESSONS.md) to avoid repeating known regressions.

## 2. Non-Negotiable Product, Privacy & Quality Invariants
- **100% Browser-Local Zero-Upload Processing**: Every PDF template, CSV/Excel roster, rendered preview, and generated ZIP/PDF MUST be processed strictly inside the browser. Production headers MUST enforce `Content-Security-Policy: default-src 'self'; connect-src 'none'; ...`. All fonts (`Noto Naskh Arabic`, `Noto Sans Arabic`, `Noto Sans`) MUST be bundled locally under `public/fonts/` — ZERO external font CDNs!
- **Zero Silent Clipping / Zero Silent Corruption (Fail-Closed)**:
  - Never silently strip XFA (`pdf-lib.getForm()` strips XFA unless checked BEFORE calling `getForm()` — check `/XFA` at entry and reject XFA, encrypted, signed, and 0-field flat PDFs with clear human explanations!).
  - Never silently clip Arabic descenders (`ن`, `ى`, `ي`, `م`, `ق`) or diacritics (`harakat`/`tashkeel`). Compute true shaped glyph ink BBox via `@pdf-lib/fontkit`, auto-fit within `[minFontSize, maxFontSize]`, center ink baseline vertically, and flag any widget/row that cannot fit cleanly without clipping!
  - Preserve text leading zeros (`00123`, `00007`) strictly as text across CSV AND `.xlsx` ingestion; warn explicitly if an Excel cell already contains scientific notation or numeric stripping!
  - Preserve every unmapped field's original `/V` value and appearance untouched (`KEEP 00109` invariance).
- **Honest Claims Only (`P0 Landing Claim Gate`)**: No fake user counts, no fake testimonials, no fake discounts, no fake payment buttons. Mark all built-in demo PDFs/CSVs explicitly as `Synthetic Sample`.
- **Disciplined SEO (`No Programmatic SEO Before Validation`)**: Cap static pre-rendered routes strictly to **<= 5 distinct high-intent routes** until live GSC indexing & click signals exist.
- **Protect C Drive**: Keep all dependencies, temp files, Playwright browser caches (`channel: 'msedge'` or `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`), and git worktrees (`D:\workspace\vibe_coding\sites\.arabiform-wt\`) strictly on `D:`.

## 3. Real-Environment Verification Mandate (Dual-Engine Visual + Browser Proof)
1. **Unit + Multi-Template Visual Pixel Proof (`npm test`)**:
   - Test across real unseen blank AcroForm templates (reuse proven fixtures & baseline methodology from `D:\workspace\vibe_coding\sites\import-medic\docs\research\M1.5\02-evidence\`) + synthetic edge cases (rotated pages, repeated widgets, long Arabic names with harakat, mixed Arabic+Latin/digits, multiline fields, leading zeros `00123`/`00007`, XFA/encrypted/flat rejections).
   - Run automated dual-engine verification (Node `pdf-lib` readback + Python `PyMuPDF` 4x pixel-bounds check) proving: exact `/V` match, embedded font present, non-empty AP, **0 clipped ink pixels at widget boundaries**, **0 pixel diff outside allowed widget rects**, and untouched unmapped fields intact!
2. **Real Browser E2E (`npm run test:e2e`, Microsoft Edge via Playwright)**:
   - Desktop (`1440x900`) and Mobile (`390x844`).
   - Upload real `.pdf` + `.csv` AND `.xlsx` rosters -> inspect live in-browser PDF canvas preview -> inspect flagged overflow rows -> edit inline or adjust min font size to resolve -> download real `.zip` AND merged single printable `.pdf` -> unzip and validate actual downloaded PDF bytes -> assert **0 outbound network requests**, **0 console errors**, **0 horizontal overflow**, and save visual screenshots to `docs/reports/screenshots/`.
3. **Production Build + Static SEO + CSP Check (`npm run build`)**: Verify <= 5 static HTML routes, `dist/_headers` with `connect-src 'none'`, unique titles/descriptions, JSON-LD, `sitemap.xml`, `robots.txt`, and zero `<form name=...>` leak vectors.
