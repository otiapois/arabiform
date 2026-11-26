# Milestone 1 (M1) — ArabiForm Complete Flagship MVP (5-Worker Agent Team + 3-Loop)

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Reference Proven Prototype**: Read `D:\workspace\vibe_coding\sites\import-medic\docs\research\M1.5\02-evidence\acroform-baseline.cjs` and `acroform-visual-check.py` (which ALREADY passed 9/10 expected-fillable fields & 5/5 flags on unseen `uspto-sb01`, `uscourts-ao440`, `uscis-i9` PDFs!).
> **Authorization**: Unlimited token / max-capability Codex orchestration explicitly authorized by user (remaining ~50% weekly quota first; do NOT touch reset card yet). Antigravity / Gemini acts as Project Manager & independent final acceptor.

## Required 5-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) and coordinate 5 specialized subagents in parallel isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`pdf-fixtures-fonts`, worktree `wt-assets`)**:
   - Download & verify OFL fonts locally into `public/fonts/` (`NotoNaskhArabic-Regular.ttf` / static regular weight — verify static TTF works cleanly with `pdf-lib` + `@pdf-lib/fontkit`, plus `NotoSans-Regular.ttf` for Latin/digits) with SHA-256 checksums and `THIRD_PARTY_NOTICES.md` preserving exact OFL/MIT licenses!
   - Build a clean, deterministic synthetic + public-template golden fixture suite under `fixtures/` (keep repo size lean & clean — generate synthetic AcroForm PDFs programmatically via a reproducible fixture generator script so tests run 100% offline with zero internet dependency, PLUS include a local test script that verifies against real blank AcroForm templates `uspto-sb01`, `uscourts-ao440`, `uscis-i9`, `irs-w9` XFA if cached in `test-results/`!).
   - Fixtures MUST cover: pure Arabic with full harakat (`بَنِي يَمَن`, `سَلْمَى بِنْت يَاسِين`, `يُسْرَى مُؤْمِن`), descenders (`ن/ى/ي/م/ق`), mixed Arabic+Latin/digits (`أحمد سالم - 00123`), leading zeros (`00123`, `00007`), rotated pages (`/Rotate 90`), repeated multi-page widgets, multiline fields, overflow (`Too Narrow`, `Too Low`, `Exceeds MaxLen`), unmapped sentinel field (`KEEP 00109`), `.xlsx` roster with text IDs + scientific notation warning, and XFA/encrypted/0-field flat PDF rejections!

2. **Worker B (`pdf-core-engine`, worktree `wt-core`)**:
   - Implement `src/core/pdf/` and `src/core/roster/` per [docs/subsystems/pdf-engine.md](../subsystems/pdf-engine.md) and [docs/subsystems/roster-mapper.md](../subsystems/roster-mapper.md).
   - Libraries: `pdf-lib`, `@pdf-lib/fontkit`, `papaparse`, `fflate` (ZIP), `bidi-js` (or clean Unicode BiDi for mixed Arabic+Latin runs), and a lightweight MIT `.xlsx` parser (verify license & bundle size before installing!).
   - Support BOTH **Individual PDFs in `.zip`** AND **Merged Single Printable PDF** (with unique per-page field renaming or clean flattening so fields never collide across pages!).
   - Build comprehensive Vitest unit + golden tests (`npm test`) AND a Python PyMuPDF (`fitz`) 4x visual pixel-bounds verification script (`scripts/verify-pdf-pixels.py` / `npm run verify:pixels`) that renders generated PDFs and mathematically proves:
     - 0 clipped ink pixels touching/crossing widget borders
     - 0 pixel diff outside allowed widget rects
     - Exact `/V` canonical value & `KEEP 00109` unmapped field preservation
     - Exact leading-zero preservation (`00123`, `00007`) across CSV and `.xlsx`!

3. **Worker C (`web-workbench`, worktree `wt-web`)**:
   - Stack: Vite + React + TypeScript (strict) + Tailwind CSS + `pdfjs-dist` (local worker bundled cleanly for in-browser PDF canvas rendering — ZERO CDN!).
   - Design: Crisp, authoritative editorial/document-studio aesthetic (warm alabaster/ivory surface, deep ink charcoal + forest/emerald pass accents + amber/crimson review alerts, crisp Arabic Naskh & monospace specimen typography, full RTL support for `/ar/pdf-mail-merge`, zero generic AI-slop gradients!).
   - Features per [docs/subsystems/web-preview-seo.md](../subsystems/web-preview-seo.md):
     - Upload `.pdf` + `.csv`/`.xlsx` OR 1-click **"Try Synthetic Arabic Sample"** button (immediately loads a clean synthetic bilingual AcroForm + 5-row Arabic roster including 1 intentionally flagged overflow row!).
     - Smart auto-mapping panel with 1-click override + sheet selector for `.xlsx` + custom filename template (`{{ID}}-{{Name}}.pdf`) + min font size control (`6–10pt`) + font selector.
     - **Live in-browser PDF page canvas preview** with row switcher and visual red overlay highlights on flagged fields!
     - Row-level preflight table with **inline cell editing** (fixing an overlong name immediately flips the row from `Flagged` -> `Ready` and updates the live PDF canvas!).
     - `Download Clean PDFs (.zip)` + `Download Merged Printable PDF` + `Download Preflight Audit (.csv / .json)`.
     - Honest `CSP: connect-src 'none'` zero-upload badge + honest synthetic sample disclosure + non-fake-checkout early-access / custom-calibration brief download card.

4. **Worker D (`seo-cloudflare`, worktree `wt-seo`)**:
   - Build static pre-rendering (`scripts/prerender.mjs`) for **strictly 5 high-intent routes** (`/`, `/arabic-pdf-form-filler`, `/ar/pdf-mail-merge`, `/preserve-leading-zeros-pdf`, `/privacy-and-proof`) — respecting `SEO完整策略.md` (`<= 5` initial pages, zero thin matrix!).
   - Emit Cloudflare Pages production bundle: `dist/_headers` (enforcing `Content-Security-Policy` with `connect-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`), `dist/sitemap.xml`, `dist/robots.txt`, unique `<title>`/`<meta description>`/canonical/`FAQPage`+`SoftwareApplication` JSON-LD, and verify `/ar/pdf-mail-merge` renders with `lang="ar" dir="rtl"`.
   - Zero `<form>` elements with data-submitting `name=` attributes.

5. **Worker E (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–D to `main`, spawn a fresh independent QA/reviewer worker:
     - Write & run Playwright real Microsoft Edge (`channel: 'msedge'`) E2E suite (`npm run test:e2e`) across desktop (`1440x900`) and mobile (`390x844`):
       - Upload real `.pdf` + `.csv` AND `.xlsx` roster
       - Verify live `<canvas>` PDF preview actually renders non-blank pixels!
       - Verify XFA/flat-PDF fail-closed error banners
       - Verify inline fix on flagged row flips count to `0`
       - Trigger real `.zip` download -> unzip bytes -> verify PDFs inside via `pdf-lib` & PyMuPDF pixel-bounds check!
       - Trigger real Merged Printable PDF download -> verify page count matches passing rows & distinct per-page text!
       - Assert **0 outbound network requests** (including 0 external font requests!), **0 console errors**, **0 uncaught page errors**, **0 horizontal overflow on 390px mobile** (including `/ar/pdf-mail-merge` RTL!).
       - Save real screenshots to `docs/reports/screenshots/` (`desktop-home.png`, `desktop-preview-flagged.png`, `desktop-fixed-ready.png`, `desktop-ar-rtl.png`, `mobile-home.png`, `mobile-preview.png`).
     - Audit against [docs/code-standards.md](../code-standards.md) -> fix all P0/P1 -> record real lessons in `LESSONS.md` -> clean up `.arabiform-wt` -> write final `docs/reports/M1-verification.md` on clean `main`!
