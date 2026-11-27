# Milestone 11 (M11 / v1.1.0) — ArabiForm Interactive PDF-Canvas Field Click-to-Map & Virtual Computed Columns

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.0.0` (Selective subset export, `?` keyboard shortcut modal, full WCAG AA audit across all 5 routes, 10,500+ fuzz, SHA-256 chain-of-custody, print-margin preflight, 500-row scale, watermarks, capacity inspector, Arabic hygiene, PyMuPDF 4x, full Edge E2E).
> **Post-1.0 Commercial Upgrade (`v1.1.0`)**: Dense real-world Arabic government, clinic, and HR PDF templates often have cryptic internal AcroForm field names (`Text1`, `Field_14`, `f_09`). Operators want to **click directly on a box on the live PDF preview** to map it immediately, AND stamp sequential receipt/certificate numbers (`0001`..`0500`) or local export dates without editing Excel first. M11 delivers **Bidirectional Canvas-to-Mapping Field Selection** and **Deterministic Virtual Computed Columns** (`v1.1.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`virtual-columns-and-12k-fuzz-core`, worktree `wt-m11-core`)**:
   - **Deterministic Virtual Computed Columns (`src/core/roster/virtual-columns.ts`)**:
     - Provide built-in virtual token/column resolvers usable in BOTH text field mappings AND filename patterns (never colliding with real roster column headers — namespaced clearly with explicit UI tokens, e.g., `@row_number` / `{{ROW_INDEX}}`, `@padded_row` / `{{PADDED_ROW_001}}`, `@today_iso` / `{{TODAY_ISO}}`, `@today_ar` / `{{TODAY_AR}}` using Western or Arabic-Indic digits as explicitly defined and deterministic when passed an injected clock/date!):
       - Strictly preserve leading zeros (`0001`, `0002`, ..., `0500`) across PDF appearance streams, `/V`, filenames, and audits!
       - Support optional custom prefix/suffix template on mapped virtual fields (e.g. `CERT-{{PADDED_ROW_001}}`) while feeding through the exact same ink-BBox & `/MaxLen` preflight engine (fail-closed if overflow!).
     - Persist virtual column mappings cleanly in v6 JSON presets (100% backward-compatible with v1–v5 presets!).
   - **Widget Overlay Geometry Metadata (`src/core/pdf/widget-overlays.ts`)**:
     - Expose normalized per-page widget bounding boxes (`pageNumber`, `fieldName`, `widgetIndex`, normalized `[x, y, width, height]` in rendered page orientation `/Rotate 0/90/180/270`) so the live PDF preview canvas can render exact clickable/keyboard-focusable hit targets for every interactive AcroForm widget!
   - **Expand Seeded Fuzz to 12,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add fuzz tests covering virtual column padding/formatting across 1–10,000 rows, custom prefix overflow detection, widget overlay coordinate projection across `/Rotate 0/90/180/270` & non-zero `/CropBox`, and v1–v6 preset backward compatibility!
   - Keep initial entry JS strictly `< 285 kB` raw / `< 89 kB` gzip (`npm run verify:release` PASS) via dynamic `import()`.

2. **Worker B (`canvas-click-map-and-virtual-ui`, worktree `wt-m11-web`)**:
   - **Interactive Click-on-PDF-Canvas Field Selection**:
     - Render crisp, subtle interactive bounding overlays over every AcroForm widget on the live PDF preview canvas (keyboard-accessible buttons with clear `aria-label`, visible high-contrast focus ring!).
     - Clicking/activating a widget overlay on the PDF preview immediately highlights and scrolls/focuses its matching row in `Field mapping` (and selecting/focusing a field row in `Field mapping` highlights its exact widget box on the canvas, even auto-jumping to its page if on another page!).
   - **Virtual Computed Column Mapping Picker**:
     - Add a clear optgroup **`Virtual columns (computed locally)`** inside each text field's column dropdown (`Row number (1, 2, 3...)`, `Padded serial (0001, 0002...)`, `Local date (YYYY-MM-DD)`, `Arabic date`) + clean hint chips in `PDF filename pattern` (EN & AR RTL!).
   - Keep idle EN & AR routes strictly at `0` PDF engine/font JS requests, `0` outbound requests, `0` horizontal mobile overflow at `390px`!

3. **Worker C (`release-docs-v1.1`, worktree `wt-m11-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.1.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (12,000+ cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including virtual serial/Arabic-date fills!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M10 Edge E2E scenarios
       - Add M11 Edge E2E scenarios:
         1. Load Multi-Page HR or Workshop PDF -> click directly on a field box on the PDF preview canvas -> verify exact matching field selector in `Field mapping` receives focus & active highlight (both mouse & keyboard!) -> change its mapping to virtual **`Padded serial (0001)`** -> verify live preview & actual downloaded ZIP PDFs contain `0001`, `0002` with 0 clipping via PyMuPDF 4x!
         2. Verify v6 preset save/reload restores virtual mappings while v1–v5 presets still load cleanly; verify `0` outbound requests, `0` console errors, `0` idle PDF font/engine JS requests, `0` horizontal mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m11/` (`desktop-m11-canvas-click-map.png`, `desktop-m11-virtual-serial.png`, `mobile-m11-canvas-map.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M11-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
