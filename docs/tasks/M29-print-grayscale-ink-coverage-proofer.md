# Milestone 29 (M29 / v2.9.0) — ArabiForm Print-Ready Grayscale Proofing & High-Contrast Monochrome Export Engine + 60,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.8.0` (Bilingual Vector Approval Stamp Library, Batch PDF Diff & Delta Reprint, MENA/EU IBAN Roster Validator, Offline `.eml` Dispatch & PII Redaction, 4-Up Print-Shop Pack, 57,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **Real-World Government, Clinic & School Laser-Print Pain (`v2.9.0`)**: Over 80% of MENA clinic consents, university exam slips, and HR letters are printed on black-and-white office laser printers — where colored watermarks, soft-colored approval seals, or thin decorative borders wash out into illegible faint gray or trigger accidental color-click billing charges at commercial print shops! M29 adds a 100% browser-local **Print-Ready Monochrome / Grayscale Proofing Engine** that renders all ArabiForm-emitted fills, covers, seals, watermarks, QR codes, and trim marks in true DeviceGray (`g`/`G`) with deterministic WCAG contrast luminance checks (`>= 7:1` black on white for text & QR, calibrated readable gray for watermarks), plus a live **Grayscale Print Proof Preview** toggle, `--monochrome-print` CLI flag, and **60,000+ deterministic adversarial fuzz cases** (`v2.9.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`monochrome-print-proofer-60k-core`, worktree `wt-m29-core`)**:
   - **Pure Zero-DOM Monochrome DeviceGray PDF Engine (`src/core/pdf/monochrome.ts`)**:
     - Adds explicit `colorMode: 'color' | 'monochrome-print'` option cleanly wired across text field appearances, bilingual covers, 2-up/4-up trim marks, QR stamps (strict `0.0` pure black on `1.0` pure white!), approval seals (converted to crisp dark charcoal/black DeviceGray vector strokes!), and watermarks (calibrated mid-gray luminance that stays readable without obscuring body text!).
     - **Deterministic Luminance & Contrast Pre-Press Audit**: computes relative luminance (`0.2126R + 0.7152G + 0.0722B`) and contrast ratio of every emitted ArabiForm ink color against white paper (`#FFFFFF`), recording `monochromeProof: true`, `colorSpace: 'DeviceGray'`, and exact contrast ratios in `custody-manifest.json` and the M24 Print-Shop Preflight Certificate!
     - Persists `colorMode` in mapping presets cleanly (backward-compatible with all earlier preset versions!) and wires `--monochrome-print` into `scripts/arabiform-cli.ts` (`fill` and `packet` modes!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 60,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) under `monochrome-print`, ZERO RGB color operators (`rg`/`RG`) are emitted by ArabiForm content streams for mapped fields, seals, QR, covers, or trim marks, (b) luminance contrast of every mapped text/QR element meets `>= 7.0:1`, and (c) preset roundtrip preserves `colorMode` cleanly! Keep heavy fuzz timeouts `>= 180_000 ms`.
   - **Strict Entry JS Budget**: Keep largest entry JS strictly `< 274 kB raw / 85.8 kB gzip` and idle routes at `0` PDF/QR/font JS!

2. **Worker B (`monochrome-proofer-ui`, worktree `wt-m29-web`)**:
   - **Lazy-Loaded `Monochrome print (DeviceGray)` Toggle & Live Grayscale Proof Preview** inside Output Settings & Live Preview canvas (EN & `/ar/` RTL, strictly 5 routes):
     - Toggle grayscale proofing on the live canvas preview + print-output checkbox (`Emit DeviceGray monochrome print PDFs`) + clear monochrome contrast badge (`QR 21:1 · Text 21:1 · Seal >= 10:1`)!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.9`, worktree `wt-m29-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.9.0`, update bilingual `CHANGELOG.md`, `README.md`, `docs/subsystems/pdf-engine.md`, and `docs/subsystems/cli-automation.md` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `fixtures/.gitattributes` wildcard rules intact!

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 60,000 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying `monochrome-print` fills, seals, QR & covers have `R == G == B` chroma-neutral pixels across all ArabiForm-drawn regions and `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--mode fill --monochrome-print` (exit `0`, verifying DeviceGray stream parity & custody manifest `monochromeProof: true`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M28 scenarios + M29 monochrome toggle, live grayscale preview, downloaded PDF chroma verification, and EN + `/ar/` RTL checks!
     - Save screenshots under `docs/reports/screenshots/m29/` (`desktop-m29-monochrome-en.png`, `desktop-m29-monochrome-ar.png`, `mobile-m29-monochrome.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M29-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
