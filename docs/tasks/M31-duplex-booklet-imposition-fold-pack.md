# Milestone 31 (M31 / v3.1.0) — ArabiForm Duplex Front/Back Badge & Certificate Imposition Engine (Mirrored Back-Side Alignment + Registration Marks) + 65,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v3.0.0` (Multi-Roster Relational Lookup Joiner, Monochrome DeviceGray Proofer, Bilingual Vector Seal Library, Batch PDF Diff & Delta Reprint, MENA/EU IBAN Validator, Offline `.eml` Dispatch, 4-Up Print-Shop Pack, 62,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **High-Value Print-Shop Duplex ID Badge & Event Pass Workflow (`v3.1.0`)**: Event organizers, conferences, and schools print **two-sided (front + back)** A6 visitor badges and bilingual certificates (Arabic front / English or schedule/QR back) on A4 duplex printers — yet naively printing 4-up leaves Alice's back printed behind Bob's front because the back sheet's left/right columns aren't mirrored for duplex flipping! M31 adds a 100% browser-local **Duplex Front/Back 2-Up & 4-Up Imposition Engine** for 2-page AcroForm templates that deterministically mirrors back-sheet column order (`Long-Edge Flip` horizontal column mirror `[2,1 / 4,3]` vs `Short-Edge Flip` vertical row mirror `[3,4 / 1,2]`), places millimeter-matched outer trim marks on front and back sheets, updates the Print Sheet Estimator & Preflight Certificate, wires `--imposition duplex-4up --duplex-flip long-edge|short-edge` into CLI, and expands deterministic fuzz to **65,000+ cases** (`v3.1.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`duplex-imposition-65k-core`, worktree `wt-m31-core`)**:
   - **Pure Zero-DOM Duplex 2-Up & 4-Up Imposition Engine (`src/core/pdf/duplex-imposition.ts`)**:
     - Accepts any **exact 2-page** eligible AcroForm template (Page 1 = Front, Page 2 = Back; strictly rejects 1-page or >=3-page templates with explicit fail-closed diagnostics when duplex imposition is requested!).
     - Interleaves physical A4 output sheets strictly as **`Sheet 1 Front -> Sheet 1 Back -> Sheet 2 Front -> Sheet 2 Back`**!
     - **Mathematically Exact Back-Sheet Slot Permutation**:
       - **`long-edge` (book flip around vertical axis)**: front `[r1, r2, r3, r4]` -> back mirrors columns `[r2_back, r1_back, r4_back, r3_back]` (with exact symmetric X/Y coordinates `backX = sheetWidth - frontX - slotWidth` so front & back cut boxes align to `0.00 pt`!).
       - **`short-edge` (calendar flip around horizontal axis)**: front `[r1, r2, r3, r4]` -> back mirrors rows `[r3_back, r4_back, r1_back, r2_back]` (with exact `backY = sheetHeight - frontY - slotHeight`!).
       - Handles partial last sheets cleanly (blank slots mirror symmetrically to the exact blank back slot — NEVER shifting a real record's back behind a blank front!).
     - Adds duplex registration ticks + outer disjoint trim marks on both front and back sheets, updates Print Sheet Estimator (exact duplex sheet & side counts) and M24 Preflight Certificate (`duplexFlip`, exact front/back page count!), and wires `--imposition duplex-2up|duplex-4up --duplex-flip long-edge|short-edge` into `scripts/arabiform-cli.ts`!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 65,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) for EVERY record `i` across `1..50` records and both flip axes, mathematically flipping the back sheet maps record `i`'s back rectangle to record `i`'s EXACT front rectangle within `0.001 pt`, (b) blank slots always align behind blank slots, and (c) 1-page or 3-page templates ALWAYS fail closed! Keep heavy fuzz timeouts `>= 180_000 ms`.
   - **Strict Entry JS Budget**: Lazy-load Duplex Imposition options so largest entry JS stays `< 274 kB raw / 85.8 kB gzip` and idle routes stay at `0` PDF/QR/font JS!

2. **Worker B (`duplex-imposition-ui`, worktree `wt-m31-web`)**:
   - **Lazy-Loaded Duplex 2-Up / 4-Up & Flip-Edge Controls** inside Print Layout (EN & `/ar/` RTL, strictly 5 routes):
     - Select `Duplex 4-up (front/back)` + `Long-edge flip` / `Short-edge flip` + visual slot-mirror schematic diagram (`Front [1|2 / 3|4]` ↔ `Back [2|1 / 4|3]`) + **1-click Synthetic 2-Sided Bilingual Visitor Badge Demo**!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v3.1`, worktree `wt-m31-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `3.1.0`, update bilingual `CHANGELOG.md`, `README.md`, `docs/subsystems/pdf-engine.md`, and `docs/subsystems/cli-automation.md` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `fixtures/.gitattributes` wildcard rules intact!

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 65,000 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying both Front & Mirrored Back A4 sheets align per-record at exact mirrored coordinates, blank slots stay 100% white, `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--mode fill --imposition duplex-4up --duplex-flip long-edge --print-certificate` (exit `0` on 2-page badge template + exit `2` on 1-page template with `0` PDFs emitted!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M30 scenarios + M31 duplex 4-up download & front/back page-order verification in EN & `/ar/` RTL!
     - Save screenshots under `docs/reports/screenshots/m31/` (`desktop-m31-duplex-en.png`, `desktop-m31-duplex-ar.png`, `mobile-m31-duplex.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M31-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
