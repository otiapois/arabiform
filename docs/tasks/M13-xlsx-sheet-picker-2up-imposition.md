# Milestone 13 (M13 / v1.3.0) — ArabiForm Multi-Sheet Excel Picker, 2-Up Print-Room Imposition with Crop Marks & 20,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.2.0` (`3afb61b`, 119/119 Vitest, 15,000 fuzz cases, PyMuPDF 4x 128 widgets + 16 independent 4x QR raster decodes, 102/102 real Edge E2E, entry JS `274.8 kB raw / 86.7 kB gzip`).
> **Print-Room Commercial Upgrade (`v1.3.0`)**: Real HR, school, and clinic Excel workbooks routinely contain multiple tabs (`Instructions`, `Summary`, `Staff_Roster_2026`), and print rooms producing visitor badges or clinic cards want **2-up print imposition** (two filled records per sheet with clean hairline cut marks) instead of wasting full sheets per card. M13 adds an explicit **Multi-Sheet Excel (`.xlsx`) Worksheet Switcher**, optional **2-Up Print Imposition for Merged Printable PDF** (preserving exact cover-sheet page ranges and vector QR stamps!), and pushes adversarial fuzzing to **20,000 deterministic cases** (`v1.3.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`xlsx-sheets-2up-imposition-20k-core`, worktree `wt-m13-core`)**:
   - **Multi-Sheet `.xlsx` Inspection & Explicit Sheet Selection (`src/core/roster/xlsx.ts`)**:
     - Inspect all visible worksheet names on `.xlsx` upload (preserving existing default behavior of selecting the first sheet so 100% of existing tests & workflows stay unchanged!).
     - Allow switching to any named worksheet in the workbook cleanly (`parseRoster(bytes, { sheetName })`), re-running field mapping & preflight deterministically while keeping exact leading zeros (`00123`), formula-value warnings, and exact SHA-256 + selected `sheetName` binding in Batch Drafts & Custody Manifests!
   - **2-Up Print-Room Imposition Mode (`imposition: '1-up' | '2-up'`, default `'1-up'`)**:
     - When enabled for **Merged Printable PDF** on single-page templates (clearly disabled with an honest note for multi-page templates, leaving `1-up` default 100% unchanged!):
       - Place 2 consecutive ready records cleanly onto a single print sheet (`2-up` stacked or side-by-side automatically chosen by source page aspect ratio to maximize print scale, with subtle crisp hairline crop/cut marks strictly outside record ink bounds!).
       - Preserve any enabled **Print Watermark** and **Local Vector QR Stamp** on each imposed record cleanly!
       - Update **Printable Batch Cover Sheet** page-range indexing accurately for `2-up` sheets (e.g., records 1 & 2 both reference physical sheet `2`, records 3 & 4 reference sheet `3`!).
       - Verify via PyMuPDF 4x (`scripts/verify-pdf-pixels.py`): non-empty ink on both top/bottom or left/right record slots, `0` clipping against sheet edges, `0` overlapping slots, and crisp cut marks!
     - Persist `imposition` cleanly in v8 JSON presets (100% backward-compatible with v1–v7 presets!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 20,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 5,000+ new deterministic fuzz cases covering multi-sheet `.xlsx` parsing/switching, `2-up` imposition layout math & cover-sheet sheet-number parity (1, 2, 3, 25, 81 records across portrait & rotated landscape badges), and v1–v8 preset compatibility!
   - **Strict Entry JS Budget**: Lazy-load new M13 UI helpers so initial entry JS remains strictly BELOW `280 kB raw / 87.5 kB gzip` (`npm run verify:release` PASS) and idle EN & AR routes remain strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`xlsx-sheets-and-2up-ui`, worktree `wt-m13-web`)**:
   - **Excel Worksheet Switcher**: Whenever an uploaded `.xlsx` workbook contains 2+ sheets, display a crisp **"Worksheet"** `<select>` right inside the `Source files` card (bilingual EN & AR RTL), resetting row edits cleanly on sheet switch while retaining template & settings!
   - **2-Up Print Imposition Toggle**: Under Output Settings, add a compact **`Merged PDF sheet layout`** selector (`1-up (standard)` default vs `2-up (2 records per sheet with cut marks)`), clearly showing an accessible note if the current template has `> 1` page!
   - Keep `0` outbound requests, `0` console errors, `0` horizontal mobile overflow at `390px`!

3. **Worker C (`release-docs-v1.3`, worktree `wt-m13-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.3.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin test), strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 20,000 cases, 0 discarded!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including `2-up` imposed sheets with QR stamp + bilingual cover sheet!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M12 Edge E2E scenarios (102 existing scenarios!)
       - Add M13 Edge E2E scenarios:
         1. Upload a 2-sheet `.xlsx` workbook (`Summary` + `Roster_AR`) -> switch worksheet from `Summary` to `Roster_AR` -> verify exact Arabic names & leading-zero IDs load and export cleanly!
         2. Enable **`2-up`** imposition + Bilingual Cover Sheet on a 3-record single-page template -> download Merged Printable PDF -> verify exact page count (`1` cover + `2` imposed sheets = `3` pages!), cover index lists Sheet `2` for rows 1–2 and Sheet `3` for row 3, and PyMuPDF 4x proves both record slots render crisp non-overlapping ink with `0` edge clipping!
         3. Verify v8 preset roundtrip (plus v1–v7 compatibility), `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m13/` (`desktop-m13-xlsx-sheet-and-2up.png`, `desktop-m13-ar-rtl-2up.png`, `mobile-m13-2up.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M13-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
