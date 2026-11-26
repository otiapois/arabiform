# Milestone 9 (M9) — ArabiForm 10,000-Case Adversarial Fuzzing, SHA-256 Chain-of-Custody Digest & Print-Margin Bleed Preflight

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v0.8.0` (500-row chunked worker, bilingual print watermarks, template capacity inspector, 8,500+ fuzz, PyMuPDF 4x, full Edge E2E).
> **Enterprise Assurance Upgrade (`v0.9.0`)**: Legal, clinic, and HR compliance teams need tamper-evident proof of exactly which template and roster produced each PDF, plus pre-print warnings when form widgets sit dangerously close to physical paper edges (`< 9 pt`). M9 reaches **10,000 deterministic adversarial fuzz cases**, adds **SHA-256 Chain-of-Custody digests**, adds **Print-Margin & Bleed Preflight advisories**, and audits `LESSONS.md` promotions (`v0.9.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`10k-fuzz-custody-bleed-core`, worktree `wt-m9-core`)**:
   - **SHA-256 Chain-of-Custody Digest Engine (`src/core/audit/custody.ts`)**:
     - Pure deterministic SHA-256 (compatible with WebCrypto & Node `crypto`, ZERO external network/dependencies!) hashing:
       - Source PDF template bytes (`templateSha256`)
       - Source roster file bytes (`rosterSha256`)
       - Every exported individual PDF inside the ZIP (`entries[].sha256`, `entries[].bytes`) and/or the Merged Printable PDF (`mergedPdfSha256`)
     - Export as a dedicated standalone **Download Chain-of-Custody Manifest (.json)** (strictly preserving 100% of existing CSV/JSON preflight audit field contracts!) AND optionally print a compact truncated digest fingerprint (`Template SHA-256`, `Roster SHA-256`) in the Printable Batch Cover Sheet footer!
   - **Print-Margin & Bleed Preflight Advisory (`src/core/pdf/margin-preflight.ts`)**:
     - Inspect every mapped AcroForm widget against the physical page `/CropBox` (fallback `/MediaBox`) in normalized coordinates across `/Rotate 0/90/180/270`.
     - Emit a non-blocking **Print-Margin Advisory** (`margin-near-edge`, default threshold `< 9 pt` ≈ `3.2 mm`) listing exact field name, page number, nearest edge (`top/bottom/left/right`), and exact clearance in `pt` so operators know before sending 200 pages to a laser printer!
   - **10,000-Case Deterministic Adversarial Fuzz Suite (`npm run test:fuzz`)**:
     - Expand seeded `fast-check` fuzzing to **>= 10,000 total accepted cases (`0` discarded, `0` crashes)** spanning: PDF geometry, Arabic harakat/tatweel/BiDi, mixed widgets, custom fonts, cover sheets, alignment overrides, Arabic text hygiene, bilingual watermarks, print-margin edge detection, SHA-256 custody determinism, and zip-slip/device names!
   - Keep initial entry JS strictly `< 300 kB` raw / `< 95 kB` gzip (`npm run verify:release` PASS).

2. **Worker B (`custody-and-bleed-ui`, worktree `wt-m9-web`)**:
   - **Chain-of-Custody Download & Verification Badge**:
     - Add **"Download Custody Manifest (.json)"** in the Download Batch panel (enabled once export/preflight runs) plus a compact, copy-friendly Template/Roster SHA-256 fingerprint preview in EN & AR RTL!
   - **Print-Margin Advisory Banner & Visual Margin Guide**:
     - When a template has widgets `< 9 pt` from physical page edge, show a crisp amber non-blocking **Print-margin advisory** card naming exact field(s), page(s), and clearance in `pt` (never blocking digital-only PDF exports!).
   - Keep `0` outbound requests, `0` idle PDF engine/font JS requests, and `0` horizontal overflow at `390px`!

3. **Worker C (`release-docs-v0.9`, worktree `wt-m9-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `0.9.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Audit `LESSONS.md` across M1–M9 and promote any lesson with `Seen >= 3` cleanly into `docs/code-standards.md`.
   - Verify `npm run verify:release`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 10,000 cases, 0 discarded!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x including cover sheet SHA-256 footer + all previous parity checks!), `npm run build`, `npm run verify:release`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M8 Edge E2E scenarios
       - Add M9 Edge E2E scenarios:
         1. Export ZIP + Custody Manifest (.json) -> unzip every PDF inside Node and independently re-compute SHA-256 of template, roster, and every single PDF member -> assert 100% bit-for-bit hash match with the downloaded Custody Manifest!
         2. Load synthetic near-edge fixture (`< 9 pt` widget margin) -> verify amber **Print-margin advisory** displays exact page & `pt` clearance while still permitting clean export!
         3. Verify `0` outbound requests, `0` console errors, `0` idle PDF font/engine JS requests, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m9/` (`desktop-m9-custody-and-margin.png`, `desktop-m9-ar-rtl-custody.png`, `mobile-m9-custody.png`).
     - Update `LESSONS.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M9-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
