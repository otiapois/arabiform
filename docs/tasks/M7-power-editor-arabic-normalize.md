# Milestone 7 (M7) — ArabiForm Arabic Text Hygiene, Per-Field Alignment Overrides, Multi-Page Preview Zoom & Portable Batch Drafts

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v0.6.0` (`c7d44a3`, 59/59 Vitest, 6,080 fuzz cases, PyMuPDF 4x 88 widgets 0-clipping + cover sheet parity, 58/58 real Edge E2E, entry JS 291.0 kB / 91.1 kB gzip).
> **Commercial Upgrade (`v0.7.0`)**: Operators working with real Arabic CSV/Excel rosters from clinics, schools, and HR portals constantly hit stray invisible Unicode characters, inconsistent Alef spellings, tight fields that need explicit centering/alignment, and multi-page forms that are hard to inspect at small zoom. M7 adds deterministic **Arabic Text Hygiene & Column Find/Replace (with 1-click Undo)**, **Per-Field Alignment Overrides**, **Multi-Page Preview Thumbnail Strip & Zoom**, **Portable Batch Draft Save/Restore**, and fixes the M6 Arabic RTL `.xlsx` BiDi visual P2 — all 100% browser-local (`CSP: connect-src 'none'`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`power-editor-arabic-hygiene-core`, worktree `wt-m7-core`)**:
   - **Deterministic Roster Hygiene & Column Find/Replace (`src/core/roster/hygiene.ts`)**:
     - Pure, zero-DOM batch transform engine operating on selected roster column(s) with exact pre-apply diff preview (`affectedRows`, `affectedCells`, up to 5 `before -> after` samples) and lossless full-state **Undo** snapshot (strictly preserving leading zeros like `00123`):
       1. `normalizeSpaces`: trim leading/trailing spaces, collapse repeated whitespace, convert NBSP (`\u00A0`) to standard space, and strip stray zero-width invisible characters (`\u200B`, `\uFEFF`) while strictly preserving legitimate Arabic shaping joiners (`ZWJ \u200D`, `ZWNJ \u200C`).
       2. `normalizeAlef` (opt-in, default `false`): normalize `أ / إ / آ -> ا`.
       3. `normalizeTaaMarbuta` (opt-in, default `false`): normalize `ة -> ه`; `normalizeAlefMaqsura` (opt-in, default `false`): normalize `ى -> ي`.
       4. `stripHarakat` (opt-in, default `false`): remove Arabic diacritics (`[\u064B-\u065F\u0670]`) when an operator explicitly chooses to fit legacy tight fields.
       5. Literal column **Find & Replace** (`find`, `replace`, `matchCase`, zero regex ReDoS).
   - **Per-Field Alignment Override (`alignOverride: 'auto' | 'rtl' | 'ltr' | 'center'`)**:
     - Extend field mapping & ink-BBox layout engine so any mapped text field can explicitly override horizontal placement (`auto` preserves exact existing behavior; `center` centers true glyph ink width inside inner field bounds; `rtl` / `ltr` forces right/left anchor while keeping mixed-script BiDi shaping accurate!).
     - Verify all 4 alignment modes (`auto`, `rtl`, `ltr`, `center`) inside `scripts/verify-pdf-pixels.ts` + `scripts/verify-pdf-pixels.py` at 4x PyMuPDF (`0` clipped ink pixels, `0` outside-widget ink, centered ink offset symmetry checked within tolerance!).
     - Persist `alignOverride` cleanly in v4 JSON mapping presets while keeping 100% backward compatibility with v1, v2, and v3 presets!
   - **Portable Batch Draft Export / Restore (`.json`)**:
     - Pure serializer/validator (`src/core/draft/batch-draft.ts`) that saves and validates an operator's manual inline cell overrides, applied hygiene summary, field mapping, and output settings as a portable `.json` file (ZERO `localStorage`, strict fail-closed schema validation, clear mismatch warning if loaded against a template/roster whose field/column names differ!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 7,500+ Total Cases**:
     - Add fuzz tests covering Arabic hygiene transforms + exact Undo roundtrip invariance, alignment overrides (`auto/rtl/ltr/center`) staying inside widget ink bounds, and malformed/adversarial draft JSON fail-closed rejection (`0` discarded, `0` crashes).
   - **Preserve Audit Contracts & Entry JS Budget**: Keep all existing CSV/JSON audit field contracts untouched, and keep initial entry JS strictly `< 300 kB` raw / `< 95 kB` gzip (`npm run verify:release` PASS).

2. **Worker B (`power-editor-ui-and-rtl-fix`, worktree `wt-m7-web`)**:
   - **Fix M6 Visual P2 (Arabic RTL `.xlsx` BiDi)**:
     - In `/ar/pdf-mail-merge` (`Source files` card), wrap `.xlsx` inside `<bdi dir="ltr">.xlsx</bdi>` (just like `.pdf` isolation) so RTL renders `.xlsx أو CSV` with the dot strictly to the left of `xlsx` rather than `xlsx.`. Verify via browser DOM Range geometry measurement in Edge!
   - **Multi-Page Preview Zoom & Page Thumbnail/Jump Strip**:
     - Add crisp zoom controls (`Fit`, `100%`, `125%`, `150%`) above the PDF preview canvas and a compact multi-page thumbnail/page-pill rail showing every page with a red dot badge on any page containing flagged widgets (clicking jumps immediately, smooth scrolling on desktop & mobile `390px` with `0` horizontal document overflow!).
   - **Roster Hygiene, Alignment Override & Batch Draft UI**:
     - Add a collapsible **"Clean & replace roster text"** panel above the roster queue showing live affected-cell preview before applying + 1-click **"Undo last transform"** button!
     - Add a compact per-field **Align** selector (`Auto`, `Right (RTL)`, `Left (LTR)`, `Center`) in Field Mapping.
     - Add **"Save Draft (.json)"** & **"Load Draft (.json)"** buttons in bilingual EN & AR RTL (clearly stating local file only, zero cloud/storage).
   - Keep idle EN (`/`, `/arabic-pdf-form-filler`) and AR (`/ar/pdf-mail-merge`) routes strictly at **0** PDF engine/font JS requests before user upload or sample click!

3. **Worker C (`release-docs-v0.7`, worktree `wt-m7-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `0.7.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release`, strictly 5 static HTML routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers` (`connect-src 'none'`, `worker-src 'self'`, `form-action 'none'`).

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (7,500+ cases), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including centered & RTL/LTR alignment overrides!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve all 58 M1–M6 Edge E2E scenarios
       - Add M7 Edge E2E scenarios:
         1. Load Workshop/HR workflow -> open **Clean & replace roster text** -> preview Alef/space cleanup & column Find/Replace -> Apply -> verify exact queue updates -> click **Undo** -> verify bit-for-bit restoration (including leading zeros)!
         2. Set per-field **Align = Center** on an Arabic name field -> verify live preview & downloaded PDF via PyMuPDF 4x pixel alignment check + save/reload v4 preset (and confirm v1/v2/v3 backward compatibility)!
         3. Multi-page HR workflow: test `Fit / 125%` zoom + clickable page strip jump to flagged page 2 + **Save Draft (.json)** -> reset/reload -> **Load Draft (.json)** restores inline edit accurately!
         4. Arabic `/ar/pdf-mail-merge`: DOM Range test verifies `.xlsx` dot sits strictly left of `xlsx` (`0 CSS px` BiDi inversion), idle routes still load `0` PDF font/engine JS, `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m7/` (`desktop-m7-hygiene-and-align.png`, `desktop-m7-multipage-zoom.png`, `desktop-m7-ar-rtl-fixed.png`, `mobile-m7-editor.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` standards into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M7-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
