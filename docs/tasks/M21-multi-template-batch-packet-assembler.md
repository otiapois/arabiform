# Milestone 21 (M21 / v2.1.0) — ArabiForm Multi-Template Batch Packet Assembler (1 Roster -> Unified Per-Person Multi-PDF Packet) & 40,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.0.0` (Arabic Numeral Policy, Official Vector Seal, Live Row Compare, Print Estimator, Offline CLI, Template Studio, 37,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **Enterprise HR & Clinic Killer Workflow (`v2.1.0`)**: Real employee onboarding, university admission, and clinic intake NEVER consist of just one PDF — every recipient gets a **multi-document packet** (`01-Offer_Letter.pdf` + `02-Clinic_Consent.pdf` + `03-Visitor_Badge.pdf`) populated from the **same single Excel/CSV roster**! M21 introduces a browser-local **Multi-Template Batch Packet Assembler** where users load `2–4` AcroForm templates in order + ONE roster -> map fields per template cleanly -> run unified cross-template ink-bounds preflight (fail-closed per person if ANY document in their packet overflows!) -> emit **ONE unified per-person Packet PDF** (`<ID>-packet.pdf`, optionally with a bilingual Packet Cover / Table of Contents!) inside a ZIP + SHA-256 Custody Manifest + CLI support, reaching **40,000+ deterministic adversarial fuzz cases** (`v2.1.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`multi-template-packet-40k-core`, worktree `wt-m21-core`)**:
   - **Pure Zero-DOM Multi-Template Packet Assembler (`src/core/packet/assembler.ts`)**:
     - Accepts `2..4` ordered AcroForm `.pdf` templates (each passing ArabiForm's full fail-closed intake guards: rejecting XFA/encrypted/signed/flat templates cleanly with exact template index & name!) + ONE shared CSV/`.xlsx` roster + per-template field mappings!
     - **Unified Cross-Template Preflight**: evaluates EVERY template for EVERY roster row cleanly; a recipient row is `ready` ONLY when ALL `2..4` documents in their packet pass ink-bounds & choice preflight (otherwise flagged with exact `templateIndex`, `templateName`, `fieldName`, and reason!).
     - **Packet Assembly Output**:
       - Builds ONE flattened, print-ready **Per-Person Packet PDF** per ready row (`<Filename>.pdf`) combining all `2..4` filled documents in order, with an optional **Bilingual Packet Cover / Document Index** (listing each included document title & starting page number inside that person's packet!).
       - Packages all per-person Packet PDFs into a ZIP (honoring safe filename & M16 group-by subfolders!) plus a **Packet Custody Manifest JSON** recording SHA-256 hashes of EVERY source template (`templates[0..N]`), the source roster, and every emitted per-person Packet PDF!
     - Wire into `scripts/arabiform-cli.ts` (`--mode packet`, exit `0` / exit `2`)!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 40,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases verifying `2..4` multi-template page-count conservation, cross-template fail-closed flagging (1 bad field in template #3 holds the whole recipient packet!), TOC page-index arithmetic, and SHA-256 custody parity!
   - **Strict Entry JS Budget**: Lazy-load the Packet Assembler UI & engine so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes remain strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`multi-template-packet-ui`, worktree `wt-m21-web`)**:
   - **Lazy-Loaded `Assemble packets` Mode Tab** (bilingual EN & AR RTL, strictly 5 static routes in `sitemap.xml`, keeping default `Fill PDFs` 100% unchanged!):
     - Add/reorder `2..4` AcroForm templates (plus **1-click Synthetic 2-Document HR + Consent Packet Demo**!) + shared CSV/`.xlsx` roster -> tabbed per-template mapping -> unified per-person readiness table -> 1-click download **Per-Person Packets (.zip)** & **Packet Custody Manifest (.json)**!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.1`, worktree `wt-m21-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.1.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 40,000 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying assembled 2-document Arabic+English recipient packet -> `0` clipping, `0` outside-box ink, accurate TOC page numbers!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M20 scenarios + M21 2-document packet assembly, cross-template fail-closed hold when doc #2 overflows, ZIP unpack & SHA-256 verification, EN & `/ar/` RTL, `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m21/` (`desktop-m21-packet-en.png`, `desktop-m21-packet-ar.png`, `mobile-m21-packet.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M21-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
