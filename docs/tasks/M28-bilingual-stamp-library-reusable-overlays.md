# Milestone 28 (M28 / v2.8.0) — ArabiForm Reusable Bilingual Vector Approval Stamp & Seal Preset Library + 57,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.7.0` (Batch PDF Diff & Delta Reprint Pack, MENA/EU IBAN & Roster Schema Validator, Offline `.eml` Dispatch & PII Redaction, 4-Up Print-Shop Pack, Template Diff, Conditional Rules, Packet Assembler, 55,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **High-Value MENA/GCC Office & Legal Ops Workflow (`v2.8.0`)**: HR, clinic, and legal teams routinely stamp outgoing Arabic/English batches with standardized visual marks (`APPROVED / معتمد`, `CONFIDENTIAL / سري للغاية`, `DRAFT / مسودة`, `PAID / مدفوع`, `CERTIFIED COPY / صورة طبق الأصل`) — currently re-typing seal strings and geometry on every run. M28 adds a 100% browser-local **Reusable Bilingual Vector Approval Stamp & Seal Library** with 5 built-in print-safe vector presets + custom circular/rectangular border geometry, safe corner/margin collision guard against AcroForm widgets & QR stamps, portable JSON export/import, `--seal-preset` CLI flag, and **57,500+ deterministic adversarial fuzz cases** (`v2.8.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`seal-library-57k-core`, worktree `wt-m28-core`)**:
   - **Pure Zero-DOM Bilingual Vector Seal Preset Library (`src/core/pdf/seal-presets.ts`)**:
     - Five built-in high-contrast bilingual presets (`approved`, `confidential`, `draft`, `paid`, `certified-copy`) plus custom stamp builder supporting `'rectangular-double-border' | 'rounded-badge' | 'circular-ring'` pure PDF vector frames, primary Arabic line (shaped via HarfBuzz/Noto Naskh Arabic with exact ink-bounds fit!), secondary English line, optional `{{Date}}` / `{{BatchId}}` subline, and WCAG-verified print-safe ink palettes (deep navy, forest green, crimson red, charcoal).
     - **Strict Fail-Closed Collision & Geometry Guard**: checks exact seal bounding box against every visible form widget, QR custody stamp, and page trim margin (including rotated/cropped/UserUnit pages!) — fails closed (`HOLD` / exit `2`) before writing any PDF if overlap or out-of-page clipping would occur!
     - Portable **Seal Preset JSON (`version: 1`)** strict validator & roundtrip serializer, cleanly linked to mapping presets and wired into `scripts/arabiform-cli.ts` (`--seal-preset <id|json-path>`).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 57,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) all 3 vector geometries stay 100% within page & non-overlapping regions across rotations `0/90/180/270` and UserUnits, (b) Arabic + English text never clips seal borders, and (c) malformed/oversized Seal Preset JSON always fails closed! Keep heavy fuzz timeouts `>= 180_000 ms`.
   - **Strict Entry JS Budget**: Lazy-load Seal Library UI so largest entry JS stays `< 274 kB raw / 85.8 kB gzip` and idle routes load `0` PDF/QR/font JS!

2. **Worker B (`seal-library-ui`, worktree `wt-m28-web`)**:
   - **Lazy-Loaded Bilingual Stamp Gallery & Customizer** inside Output Settings (EN & `/ar/` RTL, strictly 5 routes, `<bdi dir="ltr">` on extension suffixes inside Arabic buttons):
     - Visual 5-preset picker + geometry/color selector + Export/Import Seal JSON + live canvas placement preview with immediate red collision callout if a corner overlaps a field or QR!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.8`, worktree `wt-m28-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.8.0`, update bilingual `CHANGELOG.md`, `README.md`, `docs/subsystems/pdf-engine.md`, and `docs/subsystems/cli-automation.md` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `fixtures/.gitattributes` wildcard rules intact!

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 57,500 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying rectangular + circular Arabic/English seals on portrait & rotated pages -> `0` clipping, `0` widget/QR overlap!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--seal-preset approved` (exit `0`) + colliding placement (exit `2`, `0` files emitted!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M27 scenarios + M28 seal gallery selection, JSON export/re-import, live collision block, and bilingual RTL verification!
     - Save screenshots under `docs/reports/screenshots/m28/` (`desktop-m28-seal-gallery-en.png`, `desktop-m28-seal-preview-ar.png`, `mobile-m28-seal-gallery.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M28-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
