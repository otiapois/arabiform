# Milestone 19 (M19 / v1.9.0) — ArabiForm Live Batch Preview Filmstrip, Side-by-Side Row Compare, Print Sheet Estimator & 35,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.8.0` (`37549ae`, 185/185 Vitest, 32,730 fuzz cases, 5-mode offline CLI, PyMuPDF 4× 65 fills / 0 clipping, entry JS `269.3 kB / 84.1 kB gzip`, 138/138 real Edge E2E).
> **Print-Room QA Power Upgrade (`v1.9.0`)**: When HR or school admins prepare 50–500 Arabic certificates or letters, checking only row 1 isn't enough — they want to **flip rapidly across rendered previews of longest-name / flagged / boundary rows**, **compare two rows side-by-side** (e.g., shortest English name vs longest vocalized Arabic name) before committing print stock, and see an **exact deterministic Print Sheet & Paper-Savings Estimator** (`1-up` vs `2-up`, with/without Cover Sheet, grouped split packs!). M19 delivers all three (lazy-loaded to protect the `269.3 kB` entry JS budget!) plus permanent `MutationObserver` stabilization of `m5-rc.spec.ts` and **35,000+ deterministic adversarial fuzz cases** (`v1.9.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`print-estimator-row-compare-35k-core`, worktree `wt-m19-core`)**:
   - **Pure Zero-DOM Print-Room Sheet & Savings Estimator (`src/core/export/print-estimator.ts`)**:
     - Computes exact deterministic paper sheet counts across ALL active settings (ready row selection subset, template page count, `1-up` vs `2-up`, bilingual cover sheet pagination, and per-group split merged PDFs!):
       - `totalRecords`, `templatePagesPerRecord`, `coverPages`, `oneUpPhysicalSheets`, `twoUpPhysicalSheets`, `sheetsSavedByTwoUp`, `percentPaperSaved` (integer/2-decimal deterministic math!), plus `groupBreakdowns` when grouping is active!
       - Guarantees 100% exact page-count parity against actual generated Merged Printable PDF & Split Per-Group Merged PDFs!
   - **Pure Smart Boundary-Row Spotlight Selector (`src/core/preflight/spotlight.ts`)**:
     - Automatically identifies the highest-risk preview rows in any preflighted roster (`longestMappedTextRow`, `smallestFontRow`, `firstFlaggedRow`, `shortestMappedTextRow`) so print operators inspect worst-case typography in 1 click instead of manually hunting through 500 rows!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 35,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving exact page-count parity between `estimatePrintJob()` and real `mergeCover`/`imposition`/`splitGroup` page outputs across `1..500` records, odd/even groups, `1-up`/`2-up`, and multi-page templates, plus boundary-row selector determinism!
   - **Strict Entry JS Budget**: Lazy-load all M19 UI & compare helpers so initial entry JS remains strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`npm run verify:release` PASS) and idle EN & AR routes remain strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`preview-compare-estimator-ui`, worktree `wt-m19-web`)**:
   - **Lazy-Loaded Boundary Row Quick-Jump & Side-by-Side Row Compare Drawer**:
     - Quick-jump pills right above the live preview (`Longest name`, `Smallest font`, `First flagged`) + optional **"Compare two rows"** toggle rendering Row A and Row B cleanly side-by-side (stacked vertically on `390px` mobile!) with exact rendered font size, clearance, and ready/flagged status (bilingual EN & AR RTL!).
   - **Compact Print Sheet Estimator Strip** inside the Download Batch / Output Settings card showing exact physical sheets (`e.g. 2-up saves 12 sheets (48%)`, updating live as subset/grouping/cover/imposition toggles change!).
   - **Permanent Flake Fix in `tests/e2e/m5-rc.spec.ts`**: Attach a tiny DOM `MutationObserver` on `.queue p[aria-live="polite"]` BEFORE `setInputFiles(csvFile)` so transient `"Checking rows"` / `"فحص الصفوف"` announcements are reliably captured even when 2 rows finish faster than Playwright's polling interval!
   - Keep strictly 5 static routes, `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v1.9`, worktree `wt-m19-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.9.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 35,000 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M18 Edge E2E scenarios (138 existing scenarios!)
       - Add M19 Edge E2E scenarios:
         1. Load a bilingual multi-row roster -> verify Boundary Row Quick-Jump (`Longest name` / `First flagged`) jumps straight to exact worst-case row -> open **Side-by-Side Row Compare** (Row 1 vs Longest Arabic row) -> verify both canvases render distinct crisp ink!
         2. Toggle `1-up` vs `2-up` + Bilingual Cover Sheet + Group Split -> verify Print Sheet Estimator numbers match the ACTUAL downloaded Merged PDF page count 100% identically (`0` off-by-one!) on EN & `/ar/` RTL + `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m19/` (`desktop-m19-row-compare-en.png`, `desktop-m19-estimator-ar.png`, `mobile-m19-compare.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M19-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
