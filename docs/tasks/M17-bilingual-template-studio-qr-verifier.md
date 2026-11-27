# Milestone 17 (M17 / v1.7.0) — ArabiForm Built-In Bilingual Template Studio, Offline QR Custody Verifier & 30,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.6.0` (Grouped ZIP & Split Per-Group Merged PDFs, Visual Field Designer Text/Checkbox/Dropdown/Radio, Bulk Extractor, 27,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 278 kB / 87.0 kB gzip`).
> **Zero-Friction Acquisition & Verification Loop (`v1.7.0`)**: Two huge real-world moments convert casual visitors into repeat ArabiForm power users: (1) Small schools, clinics, and HR teams often arrive **without a clean AcroForm PDF template yet** and want to generate a ready-to-fill bilingual Arabic/English Certificate, HR Letter, Clinic Consent, or Visitor Badge template locally in 10 seconds with their own organization name; and (2) Recipients/auditors of ArabiForm QR-stamped PDFs want a pure offline **Verify QR / Custody Receipt** checker where they drop a stamped PDF or paste a QR payload alongside the batch custody JSON to confirm `VERIFIED_MATCH` vs `TAMPERED_OR_UNKNOWN`! M17 delivers both plus **30,000+ deterministic adversarial fuzz cases** (`v1.7.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`template-studio-qr-verifier-30k-core`, worktree `wt-m17-core`)**:
   - **Pure Zero-DOM Bilingual Starter Template Generator (`src/core/studio/templates.ts`)**:
     - Generates 4 genuine, print-clean, standard ISO 32000 AcroForm `.pdf` templates locally using ArabiForm's bundled Noto Naskh Arabic + Noto Sans fonts (ZERO external downloads!):
       1. `certificate-bilingual` (A4 Landscape Bilingual Arabic + English Completion Certificate: `RecipientName`, `CourseTitle`, `IssueDate`, `CertificateID`, `HonorsCheck`)
       2. `hr-letter-bilingual` (A4 Portrait HR Employment Verification Letter: `EmployeeName`, `EmployeeID`, `JobTitle`, `Department`, `StartDate`, `ActiveStatus`)
       3. `clinic-consent-bilingual` (A4 Portrait Clinic Patient Consent Form: `PatientName`, `NationalID`, `ClinicBranch` dropdown, `ConsentCheck`, `ContactPreference` radio)
       4. `visitor-badge-a6` (A6 Landscape Event/Office Visitor Badge: `VisitorName`, `Organization`, `BadgeID`, `AccessZone` dropdown)
     - Supports user customization: `organizationName` (Arabic and/or English), `documentSubtitle`, `accentPalette: 'forest' | 'navy' | 'burgundy' | 'slate'` (curated print-safe high-contrast colors), and `headerLanguage: 'bilingual' | 'ar' | 'en'`.
     - Every generated template passes `inspectTemplate()`, generates a matching **starter CSV roster** (`Download Starter CSV`), renders with **PyMuPDF 4× `0` clipping & `0` outside-box ink**, and works seamlessly with Fill, 2-Up Imposition, QR Stamps, and M14 Extractor!
   - **Pure Offline QR & Batch Custody Verifier (`src/core/custody/verify.ts`)**:
     - Given an ArabiForm **Batch Custody JSON** (`custody-manifest.json`) + EITHER:
       - One or more delivered `.pdf` files (recomputing exact SHA-256 of each PDF and checking against the manifest's `outputs` digest ledger!), OR
       - A scanned QR payload string (parsing ArabiForm's structured QR payload format cleanly and verifying batch digest prefix, row index, and record membership against the manifest!).
     - Returns explicit fail-closed verdicts: `VERIFIED_EXACT_MATCH` (exact SHA-256 byte match), `VERIFIED_QR_RECORD` (exact QR payload match against custody manifest), `TAMPERED_BYTE_MISMATCH` (filename present in manifest but SHA-256 differs!), or `UNMATCHED_UNKNOWN` (not issued in this custody manifest!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 30,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases testing all 4 starter templates with arbitrary Arabic/English organization titles -> `Generate -> Inspect -> Fill -> Extract` roundtrips, and single-byte PDF tamper detection in the Offline Custody/QR Verifier!
   - **Strict Entry JS Budget**: Lazy-load Template Studio & Custody Verifier so initial entry JS stays strictly BELOW `278 kB raw / 87.0 kB gzip` (`npm run verify:release` PASS) and idle EN & AR routes stay strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`template-studio-and-verifier-ui`, worktree `wt-m17-web`)**:
   - **Lazy-Loaded `Create template` & `Verify receipt` Panels**:
     - Cleanly integrate into existing bilingual EN & AR RTL workspace navigation (strictly 5 static routes in `sitemap.xml`, keeping `Fill PDFs` default 100% unchanged!):
       - **Template Studio** drawer/tab: pick from the 4 templates -> enter Organization Name (supports Arabic/English!) + accent swatch -> live preview -> **"Download AcroForm Template (.pdf)"**, **"Download Starter CSV"**, OR **"Use in Fill PDFs Now"**!
       - **Verify PDF / QR Custody** drawer/tab: drop Batch Custody JSON + drop delivered PDF(s) or paste QR payload -> crisp green `VERIFIED` / red `TAMPERED` / amber `UNKNOWN` verdict cards with exact SHA-256 side-by-side comparison!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v1.7`, worktree `wt-m17-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.7.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin test), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 30,000 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× rendering ALL 4 generated starter templates filled with vocalized Arabic + English -> `0` clipping, `0` outside-box ink!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 278 kB / 87.0 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M16 Edge E2E scenarios
       - Add M17 Edge E2E scenarios:
         1. Open **Template Studio** -> customize Arabic + English Organization Name on `Bilingual Certificate` -> click **"Use in Fill PDFs Now"** -> batch-fill with vocalized Arabic names + download ZIP & Custody JSON -> open **Verify PDF / QR Custody** -> verify exact PDF returns `VERIFIED_EXACT_MATCH` AND a 1-byte-modified copy returns `TAMPERED_BYTE_MISMATCH`!
         2. Test `/ar/` RTL Template Studio & QR payload verification + `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow at `390px`!
     - Save screenshots under `docs/reports/screenshots/m17/` (`desktop-m17-template-studio-en.png`, `desktop-m17-template-studio-ar.png`, `desktop-m17-custody-verifier.png`, `mobile-m17-studio.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M17-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
