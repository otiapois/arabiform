# Milestone 18 (M18 / v1.8.0) — ArabiForm Offline Batch Automation CLI (`arabiform-cli`) & 32,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.7.0` (Built-In Bilingual Template Studio, Offline QR/Custody Verifier, Grouped Exports, Visual Field Designer, Bulk Extractor, 30,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 278 kB / 87.0 kB gzip`).
> **Institutional & Print-Shop Automation Upgrade (`v1.8.0`)**: Universities, hospital groups, and print shops running monthly 500–5,000-record Arabic PDF batches want to design/test interactively in ArabiForm's browser studio, export their verified JSON preset, and then execute deterministic zero-network batch runs locally from their own terminal or internal server without cloud dependencies. M18 adds an official local zero-network CLI (`npm run arabiform-cli -- ...` via `scripts/arabiform-cli.ts` + pure `src/core/cli/` dispatcher) supporting `preflight`, `fill`, `extract`, `verify`, and `studio` subcommands with deterministic exit codes (`0` clean, `2` flagged/blocked with JSON diagnostics, `1` usage/IO error), plus **32,500+ deterministic adversarial fuzz cases** (`v1.8.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`offline-batch-cli-32k-core`, worktree `wt-m18-core`)**:
   - **Local Zero-Network CLI (`src/core/cli/` + `scripts/arabiform-cli.ts` + `package.json` script `arabiform-cli`)**:
     - Strictly reuses the exact pure zero-DOM `src/core/` engines (ZERO duplicated PDF/shaping/extraction/custody logic!):
       - `--mode preflight`: inspects template + roster (`.csv`/`.xlsx` + `--sheet`) + optional `--preset <json>` -> writes deterministic diagnostics CSV & JSON; exits `0` when all rows ready, **`2`** when any row is flagged or intake blocked!
       - `--mode fill`: runs preflight and emits Editable ZIP, Flattened ZIP, Merged Printable PDF (supporting `--imposition 1-up|2-up`, `--cover`, `--watermark`, `--qr`, `--group-by <col>`), plus `custody-manifest.json` into `--out-dir <dir>` (refusing output and exiting **`2`** if `--strict` is set and any row fails preflight!).
       - `--mode extract`: extracts `1..200` filled PDFs from `--in-dir <dir>` or file args -> writes UTF-8 BOM CSV, text-typed `.xlsx`, and `extraction-audit.json`!
       - `--mode verify`: verifies delivered PDFs or `--qr-payload` against `--manifest <custody-manifest.json>` (`VERIFIED_EXACT_MATCH` exit `0`, `TAMPERED_BYTE_MISMATCH`/`UNMATCHED_UNKNOWN` exit `2`!).
       - `--mode studio`: generates any of the 4 built-in bilingual starter AcroForm `.pdf` templates + starter CSV locally!
     - Strictly enforces safe output paths (rejecting path traversal `..` and zero network calls!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 32,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases validating CLI argument/path sanitization, exact byte parity between CLI core dispatch and browser core engines, and fail-closed exit-code-2 invariants!
   - **Strict Entry JS Budget**: Keep initial entry JS strictly BELOW `278 kB raw / 87.0 kB gzip` (`npm run verify:release` PASS) and idle EN & AR routes strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`cli-command-snippet-ui`, worktree `wt-m18-web`)**:
   - **Optional Copy-Ready Local CLI Command Helper** (lazy-loaded inside Preset / Export drawer on `/` and `/ar/`): displays the exact offline `npm run arabiform-cli -- --mode fill ...` command reflecting active sheet/imposition/grouping/preset settings (bilingual EN + AR RTL, zero clutter on main workbench, `0` outbound requests, `0` console errors, `0` mobile overflow at `390px`!).

3. **Worker C (`release-docs-v1.8`, worktree `wt-m18-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.8.0`, document every CLI mode, flag, and exit code accurately in bilingual `README.md`, `CHANGELOG.md`, and `docs/subsystems/cli-automation.md` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 32,500 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 278 kB / 87.0 kB gzip`!)
     - **Real Subprocess CLI End-to-End Verification**: Execute all 5 CLI modes (`studio` -> `preflight` -> `fill` -> `extract` -> `verify`) in real Node subprocesses into D-drive temp folders, verifying exact exit code `0` on valid runs, exit code `2` on tampered PDF / flagged strict preflight, PyMuPDF 4× `0` clipping on CLI-generated Arabic PDF, and bit-for-bit SHA-256 parity with `custody-manifest.json`!
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M17 scenarios + M18 CLI snippet UI copy/a11y check (`0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow).
     - Save screenshots under `docs/reports/screenshots/m18/` (`desktop-m18-cli-helper-en.png`, `desktop-m18-cli-helper-ar.png`, `mobile-m18-cli-helper.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M18-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
