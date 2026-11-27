# Milestone 24 (M24 / v2.4.0) — ArabiForm Print-Shop Production Pack (A4 4-Up Grid Imposition + Trim Crop Marks + Bilingual Preflight Certificate PDF) + 47,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.3.0` (Template Diff & Preset Migrator, Conditional Field Rules, Multi-Template Batch Packet Assembler, Arabic Numeral Policy & Official Vector Seal, Live Row Compare, Print Estimator, Offline CLI, 45,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **Commercial Print-Shop Final Mile (`v2.4.0`)**: Event organizers printing hundreds of **A6 Visitor Badges, Clinic Appointment Cards, or Event Tickets** waste 50%–75% paper with 1-up/2-up layouts — commercial print shops want **A4 4-Up Grid Imposition (`2×2` per A4 sheet = 75% paper savings!)** with crisp **guillotine corner trim crop marks**, an instant **Print-Estimator 4-Up savings calculation**, AND a 1-page **Bilingual Print-Shop Preflight Certificate PDF** (embedding exact SHA-256 of the print-ready PDF, sheet count, imposition mode, embedded font inventory, and `0 clipped fields` verification receipt!) that ops teams send directly to the printer. M24 delivers all three 100% locally in browser + `arabiform-cli`, verified at PyMuPDF 4×, reaching **47,500+ deterministic adversarial fuzz cases** (`v2.4.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`printshop-4up-certificate-47k-core`, worktree `wt-m24-core`)**:
   - **A4 4-Up (`2×2`) Grid Imposition Engine (`imposition: '1-up' | '2-up' | '4-up'`) (`src/core/pdf/imposition.ts`)**:
     - Extends M13 2-Up cleanly to support **`4-up` (`2×2` grid on A4 Portrait or Landscape — automatically picking the orientation that maximizes uniform card scale while respecting safe outer margins & inter-card gutters!)** for single-page templates (fail-closed / clean fallback to `1-up` for multi-page templates, matching M13 & M19 Print Sheet Estimator conservation!).
     - Draws pure-vector **Guillotine Corner Crop Marks** (strictly OUTSIDE each card's ink boundary — zero overlap with card artwork or Arabic glyphs, verified at PyMuPDF 4×!) plus optional center cut-guide hairlines and optional **Duplex Cut-Stack Order** (`sequential` vs `cut-and-stack` so guillotine stacks stay in exact roster order!).
     - Updates `estimatePrintJob` (`M19`) so the live Print Sheet Estimator accurately computes `1-up`, `2-up`, and `4-up` physical sheet counts and exact `%` paper savings (matching downloaded PDFs page-for-page!).
   - **Bilingual Print-Shop Preflight Certificate PDF (`src/core/pdf/print-certificate.ts`)**:
     - Generates a crisp, 1-page printable **Bilingual (EN + AR) Print-Shop Preflight Certificate PDF** (`print-shop-certificate.pdf`, zero external resources!) embedding:
       - Source Template filename + SHA-256, Roster filename + SHA-256, Print-Ready Output PDF filename + SHA-256,
       - Ready vs Excluded row counts, Imposition Grid (`1-up / 2-up / 4-up`), Physical Sheet Count, Cover Page Count,
       - Embedded Font Names & Minimum Rendered Font Size (`pt`), plus `"0 clipped fields verified"` status badge (refuses to issue a clean certificate if `readyCount === 0`!).
     - Wire `--imposition 4-up` and `--print-certificate` cleanly into `scripts/arabiform-cli.ts` AND v12 JSON presets (100% backward-compatible with v1–v11!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 47,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases verifying `4-up` grid slot bounding-box disjointness (no two slots or crop marks ever overlap!), `ceil(readyCount / 4)` exact physical sheet conservation across combined & split grouped jobs, `cut-and-stack` permutation bijectivity (every ready row appears exactly once!), and Preflight Certificate SHA-256 parity!
   - **Strict Entry JS Budget**: Lazy-load new M24 UI/PDF controls so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`printshop-4up-certificate-ui`, worktree `wt-m24-web`)**:
   - Extend Output Settings cleanly with **`4-Up A4 Grid (75% savings)`** imposition option + optional **`Cut-and-stack order`** toggle + live Print Sheet Estimator 4-Up savings readout + 1-click **`Download Print-Shop Certificate (.pdf)`** button right beside Merged Print PDF & Custody Manifest (bilingual EN & AR RTL, strictly 5 static routes!).
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.4`, worktree `wt-m24-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.4.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 47,500 cases, 0 discarded; keep `>= 180_000 ms` timeouts on large fuzz tests!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying real A4 4-Up imposed A6 Arabic Visitor Badges + corner crop marks + Print-Shop Preflight Certificate PDF -> `0` clipping, `0` crop-mark overlap!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--imposition 4-up --print-certificate` (verifying exact page count & SHA-256 match inside the emitted Certificate PDF!).
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M23 scenarios + M24 4-Up imposition export, estimator 4-Up page parity, and Print-Shop Preflight Certificate PDF download & readback, EN & `/ar/` RTL, `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m24/` (`desktop-m24-4up-estimator-en.png`, `desktop-m24-4up-certificate-ar.png`, `mobile-m24-4up.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M24-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
