# Milestone 6 (M6) — ArabiForm Printable Batch Cover Sheet, Interactive Ink-Bounds Proof & 4-Workflow E2E Coverage

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v0.5.0` + M6-Part1 (`3a71574`, 52/52 Vitest, 5,060 fuzz cases, PyMuPDF 4x 76 widgets 0-clipping, 42/42 Edge E2E, entry JS 288 kB / 90.4 kB gzip).
> **Reset-Card Wave Objective**: Elevate ArabiForm into a print-room-ready commercial studio (`v0.6.0`) with an optional Printable Batch Cover Sheet for Merged Printable PDFs, interactive visual ink-bounds comparison on landing pages, complete Edge E2E coverage across all 4 lazy synthetic workflows & batch font optimizer, and 6,000+ adversarial fuzz coverage.

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`cover-sheet-and-6k-fuzz`, worktree `wt-m6-core`)**:
   - **Printable Batch Cover Sheet (`includeCoverSheet: boolean`, default `false`)**:
     - When enabled for `Download Merged Printable PDF`, prepend a crisp, auto-paginated printable manifest cover page (rendered using our local embedded Noto Naskh Arabic + Noto Sans fonts — ZERO external assets, full Arabic filename support!) showing:
       - Header (`ArabiForm · Batch Print Manifest` or Arabic equivalent when locale is `ar`), local export date, template filename, Ready / Flagged / Skipped row counts, active min font size & font mode.
       - Compact index table listing each printed row: `#`, `Row`, `Filename` (cleanly shaped for Arabic/Latin), and exact `Pages` range inside the merged PDF (e.g. `2`, `3–4`, `5–6`, offset cleanly by the cover sheet page count!).
       - Verify cover sheet rendering via PyMuPDF 4x (`scripts/verify-pdf-pixels.py`): non-empty crisp ink inside page margins, 0 clipping against page borders, and every subsequent filled form page still 100% pixel-identical to its individual PDF!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 6,000+ Total Cases**:
     - Add fuzz tests covering Printable Cover Sheet pagination (1 row, 25 rows, 80 rows with long Arabic filenames), batch font optimizer edge cases, and multi-page index page-range arithmetic (`0` discarded, `0` crashes).
   - **Preserve Entry JS Budget**: Keep initial entry JS `< 300 kB` raw / `< 95 kB` gzip and verify `npm run verify:release` passes!

2. **Worker B (`cover-sheet-ui-and-ink-proof`, worktree `wt-m6-web`)**:
   - **Cover Sheet Toggle**:
     - Add an explicit checkbox under Output Settings: **"Include printable cover sheet in Merged PDF"** (with clean Arabic RTL copy on `/ar/pdf-mail-merge`, saved cleanly in backward-compatible JSON mapping presets!).
   - **Interactive Visual Ink-Bounds Specimen Toggle**:
     - Enhance the **"Why ink-bounds preflight matters"** section on `/arabic-pdf-form-filler` and `/ar/pdf-mail-merge` with a lightweight, pure-CSS/SVG interactive toggle (**"Naive baseline (clipped)" vs "ArabiForm ink-bounds (0 clipped)"**) clearly labeled `Synthetic specimen: بَنِي يَمَن / سَلْمَى بِنْت يَاسِين` so visitors instantly understand the value of our ink-BBox engine in 3 seconds without adding heavy assets or breaking idle zero-PDF-font-JS rules!
   - **Polish 4-Workflow Gallery UI**: Ensure all 4 synthetic workflow cards/buttons (`Workshop Attendance`, `Clinic Consent`, `Multi-Page HR Choices`, `Landscape Visitor Badge`) look crisp and editorial on desktop `1440x900` and mobile `390x844` (EN & AR RTL, 0 horizontal overflow!).

3. **Worker C (`release-docs-v0.6`, worktree `wt-m6-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `0.6.0`, update bilingual `CHANGELOG.md` and `README.md`, sync `docs/subsystems/`, and verify `.github/workflows/ci.yml`, `THIRD_PARTY_NOTICES.md`, strictly 5 static routes, and `dist/_headers` (`connect-src 'none'`, `worker-src 'self'`, `form-action 'none'`) pass `npm run verify:release`!

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (6,000+ cases), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including cover sheet + merged pages pixel parity!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve all 42 M1–M5 Edge E2E scenarios
       - Add M6 Edge E2E scenarios:
         1. Load each of the 4 lazy synthetic workflows via UI buttons -> verify idle route NEVER loads PDF font/engine JS before click; verify Landscape Badge batch font optimizer 1-click fixes row & exports clean PDF!
         2. Enable **"Include printable cover sheet in Merged PDF"** -> download Merged Printable PDF -> verify page 1 is the cover sheet with exact page-range manifest & rendered ink via PyMuPDF, and pages 2..N match individual PDFs pixel-for-pixel at 4x!
         3. Interactive ink-bounds specimen toggle works via click & keyboard on `/arabic-pdf-form-filler` and `/ar/pdf-mail-merge` with 0 outbound requests, 0 console errors, 0 mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m6/` (`desktop-m6-workflow-gallery.png`, `desktop-m6-ink-toggle.png`, `desktop-m6-ar-rtl-gallery.png`, `mobile-m6-gallery.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` standards into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M6-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
