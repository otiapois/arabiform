# Milestone 8 (M8) — ArabiForm 500-Row Chunked Scale, Bilingual Print Watermarks & Template Field Capacity Inspector

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v0.7.0` (Arabic text hygiene + undo, per-field alignment overrides, multi-page preview zoom, portable batch drafts, 7,500+ fuzz, PyMuPDF 4x, full Edge E2E).
> **Commercial Upgrade (`v0.8.0`)**: Operations teams at training academies, clinics, and Gulf HR offices process 300–500 forms per batch, often need bilingual `DRAFT / مسودة` or `CONFIDENTIAL / سري` print stamps, and want to know a template's exact field capacities *before* cleaning their Excel roster. M8 delivers **500-row bounded-memory chunked processing**, **local bilingual PDF print watermarks**, and a **Template Field Capacity Inspector Table** (`v0.8.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`scale-watermarks-inspector-core`, worktree `wt-m8-core`)**:
   - **Template Field Capacity Inspector (`src/core/pdf/capacity-inspector.ts`)**:
     - Pure analyzer running immediately upon template intake (zero roster needed!) producing a structured capacity report for every interactive AcroForm field: field name, type (`text | checkbox | dropdown | radio`), page number(s), widget rotation (`0/90/180/270`), inner box width & height in `pt`, `/MaxLen` (if any), and deterministic estimated max characters for **Arabic Naskh (with harakat)** and **Latin Sans** at the active minimum font size (computed directly via our real `fontkit` glyph-shaping engine, NOT rough heuristics!).
   - **Optional Bilingual Print Watermark / Stamp Overlay (`src/core/pdf/watermark.ts`)**:
     - Supports `none` (default), preset bilingual stamps (`DRAFT`, `CONFIDENTIAL`, `مسودة`, `سري`), or explicit custom short stamp text (max 32 chars, fail-closed on missing glyphs!), configurable opacity (`0.08–0.30`, default `0.14`) and diagonal angle (`-45°` / `45°` / `0°`).
     - Rendered using local embedded Noto Naskh Arabic + Noto Sans fonts (ZERO external assets!) onto **Merged Printable PDF** and **Flattened Individual PDFs in ZIP** (leaving Editable AcroForm ZIP fields intact and unmodified unless flattened, clearly disclosed!).
     - Verify via PyMuPDF 4x (`scripts/verify-pdf-pixels.py`): watermark ink stays strictly within page bounds (`0` edge clipping), non-empty visible watermark pixels exist inside page interior, and field text ink remains cleanly legible with zero broken AcroForm appearances!
   - **500-Row Chunked Bounded-Memory Worker Pipeline**:
     - Refactor worker batch loop to process in explicit bounded chunks (`chunkSize = 25`), yielding progress updates smoothly, supporting mid-batch cancel with immediate memory release, and adding a deterministic 500-row benchmark test!
   - **Expand Seeded Fuzz to 8,500+ Cases** (`0` crashes, `0` discarded) covering watermark geometry across portrait/landscape/rotated pages, capacity inspector bounds, and chunked worker state consistency.
   - Keep initial entry JS strictly `< 300 kB` raw / `< 95 kB` gzip (`npm run verify:release` PASS).

2. **Worker B (`scale-watermarks-inspector-ui`, worktree `wt-m8-web`)**:
   - **Template Capacity Inspector Drawer/Table**:
     - Immediately after a user uploads a PDF template (or clicks a synthetic workflow), display a clean expandable **"Inspect template field capacities (N fields)"** table showing page, type, `W × H pt`, `/MaxLen`, and estimated Arabic/Latin character capacity (plus 1-click CSV export of the template capacity sheet so teams can hand exact limits to roster authors!).
   - **Bilingual Print Watermark Controls**:
     - Add clean **"Print watermark (optional)"** selector under Output Settings (`None`, `DRAFT`, `CONFIDENTIAL`, `مسودة`, `سري`, `Custom...`) + opacity slider (`10%–25%`), saved cleanly in v5 JSON mapping presets (100% backward-compatible with v1–v4!).
   - **500-Row Responsive Progress & Search Polish**: Ensure live progress bar, row counter, cancel button, and instant queue search stay smooth on desktop & mobile `390px` (`0` overflow, `0` idle PDF JS requests!).

3. **Worker C (`release-docs-v0.8`, worktree `wt-m8-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `0.8.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (8,500+ cases), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including bilingual Arabic & English watermarks on portrait + rotated landscape pages!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M7 Edge E2E scenarios
       - Add M8 Edge E2E scenarios:
         1. Upload PDF template alone (no roster!) -> open **Template Field Capacity Inspector** -> verify exact field dimensions, rotation, `/MaxLen`, and Arabic/Latin character estimates + download template capacity CSV!
         2. Enable bilingual Arabic watermark (`مسودة`) -> download Merged Printable PDF -> verify via PyMuPDF 4x that watermark renders cleanly inside margins with `0` page-edge clipping & `0` missing glyphs; verify v5 preset roundtrip!
         3. Run live **500-row** synthetic Arabic/Latin batch in real Edge Web Worker -> measure completion time, verify live progress & responsive search without freezing UI, verify `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m8/` (`desktop-m8-capacity-inspector.png`, `desktop-m8-watermark-settings.png`, `mobile-m8-capacity.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` standards into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M8-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
