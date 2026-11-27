# Milestone 12 (M12 / v1.2.0) — ArabiForm Local Vector QR Verification Stamp, Bilingual Dual-Language Cover Manifest & 15,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.1.0` (Interactive PDF-canvas click-to-map, deterministic virtual computed columns, 12,000+ fuzz, selective subset export, SHA-256 custody, PyMuPDF 4x, full Edge E2E).
> **Post-1.0 Flagship Upgrade (`v1.2.0`)**: Training certificates, clinic wristbands/consents, event badges, and HR letters across MENA routinely require a scannable per-record **QR Verification Stamp** (encoding each person's ID/serial/verification code locally with zero cloud QR API!) and **Bilingual EN + AR Cover Manifests** for print rooms serving mixed Arabic/English teams. M12 adds a **Pure Zero-Dependency Local Vector QR Stamp** and **Bilingual Dual-Language Cover Sheet**, pushing adversarial fuzz coverage to **15,000+ cases** (`v1.2.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`vector-qr-dual-cover-15k-core`, worktree `wt-m12-core`)**:
   - **Pure Zero-Dependency Local Vector QR Encoder & PDF Stamp (`src/core/pdf/qr-stamp.ts`)**:
     - Implement a compact, spec-compliant pure TypeScript **QR Code (ISO/IEC 18004, Versions 1–6, Byte mode, Error Correction Level M, Reed-Solomon GF(256) + optimal mask selection)** with ZERO external npm packages and ZERO network calls!
     - Render crisp black-on-white vector PDF rectangles (with mandatory 4-module quiet zone!) onto **Merged Printable PDF** and **Flattened Individual PDFs in ZIP** at a user-selected corner anchor (`none`, `top-right`, `top-left`, `bottom-right`, `bottom-left`, configurable size `36–72 pt`, respecting page `/CropBox` & `/Rotate 0/90/180/270` and 9 pt safe margin!), encoding a user pattern (e.g. `{{ID}}` or `CERT-{{PADDED_ROW_001}}`, fail-closed on empty/over-capacity payload!).
     - Independently verify every generated QR matrix in unit tests AND via PyMuPDF 4x (`scripts/verify-pdf-pixels.py`): verify exact finder-pattern modules (`7x7` corners), quiet zone clearance, `0` page-edge clipping, and exact scannable module grid parity!
   - **Bilingual Side-by-Side Cover Manifest Mode (`coverLanguage: 'auto' | 'en' | 'ar' | 'bilingual'`)**:
     - Extend Printable Batch Cover Sheet with a **`Bilingual (EN + AR)`** print-room option displaying paired English & Arabic manifest headers and stats cleanly on page 1 using local embedded Noto fonts (`0` clipping at 4x PyMuPDF!).
     - Persist QR stamp & cover language cleanly in v7 JSON presets (100% backward-compatible with v1–v6!).
   - **Expand Seeded Fuzz to 15,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add fuzz tests covering QR Reed-Solomon encoding, payload byte limits (ASCII + UTF-8 Arabic!), corner placement across `/Rotate 0/90/180/270` & non-zero `/CropBox`, and bilingual cover pagination!
   - Keep initial entry JS strictly `< 285 kB` raw / `< 89 kB` gzip (`npm run verify:release` PASS) via dynamic `import()`.

2. **Worker B (`qr-stamp-and-bilingual-cover-ui`, worktree `wt-m12-web`)**:
   - **QR Verification Stamp Settings Card**:
     - Add a crisp lazy-loaded **"Print QR stamp (optional)"** section under Output Settings (Placement `None / Top-right / Top-left / Bottom-right / Bottom-left`, Pattern e.g. `{{ID}}`, Size `48 pt`, live miniature SVG QR preview for the currently selected row so the operator sees the exact scannable QR before exporting!).
   - **Cover Sheet Language Selector**:
     - When `Include printable cover sheet in Merged PDF` is enabled, reveal compact language choice (`Match page`, `English`, `العربية`, `Bilingual (EN + AR)`).
   - Keep idle EN & AR routes strictly at `0` PDF/QR JS requests, `0` outbound requests, `0` horizontal mobile overflow at `390px`!

3. **Worker C (`release-docs-v1.2`, worktree `wt-m12-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.2.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (15,000+ cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including QR finder-pattern & quiet-zone pixel verification on portrait + rotated 90° pages + bilingual cover sheet!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M11 Edge E2E scenarios
       - Add M12 Edge E2E scenarios:
         1. Enable QR Stamp (`bottom-right`, pattern `CERT-{{ID}}`) + Bilingual EN+AR Cover Sheet -> verify live SVG QR preview updates per row -> download Merged Printable PDF & Flattened ZIP -> verify via PyMuPDF 4x that every stamped page contains an exact crisp QR matrix inside margins with `0` clipping AND Editable ZIP stays untouched!
         2. Verify v7 preset roundtrip (plus v1–v6 compatibility), `0` outbound requests, `0` console errors, `0` idle PDF/QR JS requests, `0` horizontal mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m12/` (`desktop-m12-qr-stamp-preview.png`, `desktop-m12-ar-rtl-qr.png`, `mobile-m12-qr.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M12-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
