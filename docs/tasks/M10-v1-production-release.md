# Milestone 10 (M10 / v1.0.0) — ArabiForm Selective Subset Export, Keyboard & WCAG AA Audit, and Production v1.0.0 Release Candidate

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v0.9.0` (10,000+ fuzz, SHA-256 chain-of-custody, print-margin bleed preflight, 500-row scale, watermarks, capacity inspector, Arabic hygiene, PyMuPDF 4x, full Edge E2E).
> **Production Release Goal (`v1.0.0`)**: Finish every last-mile operator ergonomics & accessibility detail — **Selective / Filtered Batch Subset Export** (re-export only the rows you checked/fixed without regenerating all 200 PDFs!), **Keyboard Shortcut Cheat-Sheet (`?`) & full WCAG AA Contrast/Focus Audit across all 5 routes**, final strict-origin release verification, and official **`v1.0.0`** production readiness!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`subset-export-v1-core`, worktree `wt-m10-core`)**:
   - **Selective / Filtered Subset Export (`rowSelection: 'all-ready' | number[]`)**:
     - Allow exporting a deterministic subset of ready rows (explicit selected row indices or current filtered ready rows) across **ZIP**, **Merged Printable PDF** (with accurate subset Cover Sheet page-range index!), **Preflight Audit**, and **Chain-of-Custody Manifest** (explicitly recording `exportScope: 'all-ready' | 'selected-subset'` and exact selected original row numbers!).
     - Fail-closed if zero selected rows are ready (`exportDisabled`, clear bilingual hint) and guarantee filename collision deduplication remains deterministic across subset exports!
   - **Real-World Public Template & Regression Sweep**:
     - Run and verify every golden fixture + preserved public template check + 10,500+ seeded fuzz cases (`0` discarded, `0` crashes) including subset cover-sheet pagination and subset custody SHA-256 integrity.
   - Keep initial entry JS strictly `< 300 kB` raw / `< 95 kB` gzip (`npm run verify:release` PASS).

2. **Worker B (`subset-ui-a11y-v1`, worktree `wt-m10-web`)**:
   - **Row Selection Checkboxes & Subset Export Toggle**:
     - Add crisp row checkboxes in the roster queue (plus **"Select filtered ready"** / **"Clear selection"** controls) and an explicit export scope badge (**"All ready (N)"** vs **"Selected only (K)"**) right above the Download Batch buttons!
   - **Keyboard Shortcut Cheat-Sheet Modal (`?`) & Full WCAG AA Polish**:
     - Press `?` (when not typing in an input) or click a subtle footer/toolbar `Shortcuts (?)` button to open an accessible modal listing all live shortcuts (`/` focus search, `Escape` close/cancel with exact focus restoration, `ArrowUp/ArrowDown` or `J/K` queue navigation, `?` shortcuts help).
     - Perform a systematic **WCAG AA contrast, focus-ring, landmark, and ARIA live-region audit** across ALL 5 static routes (`/`, `/arabic-pdf-form-filler`, `/ar/pdf-mail-merge`, `/guides/...` / all routes in `verify-release-bundle`) on desktop `1440x900` and mobile `390x844`!
     - Fix any visual spacing, BiDi, or contrast micro-imperfection so zero P0/P1/P2 defects remain!

3. **Worker C (`release-docs-v1.0`, worktree `wt-m10-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to **`1.0.0`**.
   - Polish `README.md`, bilingual `CHANGELOG.md` (clean `v0.1.0 -> v1.0.0` progression), `docs/launch/cloudflare-pages-7day-launch.md` (with verified `npm run build && npm run verify:release -- --strict-origin https://arabiform.com` exact command recipe), `THIRD_PARTY_NOTICES.md`, and `.github/workflows/ci.yml`! Zero fake testimonials, zero invented metrics!

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run complete **v1.0.0 Production Release Acceptance**:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (10,500+ cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x full sweep!), `npm run build`, `npm run verify:release`, AND test `verify:release` strict-origin mode!
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M9 Edge E2E scenarios
       - Add M10 Edge E2E scenarios:
         1. Select 2 specific ready rows from a multi-row batch -> export **Selected only (2)** ZIP + Merged Printable PDF with Cover Sheet + Custody Manifest -> verify ZIP has strictly those 2 PDFs, Cover Sheet indexes strictly those 2 original row numbers, and SHA-256 hashes match bit-for-bit!
         2. Keyboard & Accessibility sweep across ALL 5 static routes (EN & AR RTL): verify `?` shortcuts modal opens & `Escape` restores exact trigger focus, verify programmatic WCAG AA contrast ratios (`>= 4.5:1` body text, `>= 3:1` UI controls), verify `0` missing labels, `0` outbound requests, `0` console errors, `0` idle PDF font/engine JS requests, `0` horizontal mobile overflow!
     - Save final v1.0.0 showcase screenshots under `docs/reports/screenshots/v1.0/` (`desktop-v1-en-workbench.png`, `desktop-v1-ar-rtl-workbench.png`, `desktop-v1-shortcuts-modal.png`, `mobile-v1-workbench.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` standards into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M10-v1.0-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
