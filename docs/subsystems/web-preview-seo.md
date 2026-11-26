# Subsystem: Local Workbench, Live PDF Preview & Static SEO (`src/web/`)

## Workbench UX Standards
- The Arabic **Source files** roster hint isolates the `.xlsx` extension in `<bdi dir="ltr">.xlsx</bdi>`. The visible left-to-right order is `.xlsx أو CSV`, with the dot to the left of `xlsx`. Verify that order with a browser DOM Range measurement.
- **Synthetic demo** — **Try Synthetic Arabic Sample** loads a sample clearly labeled `Synthetic Sample` under the P0 landing claim gate:
  - A fillable synthetic AcroForm template,
  - A synthetic bilingual Arabic roster (`ليلى حسن / 00123`, `أحمد سالم / 00007`, `بَنِي يَمَن / 00891`, plus 1 intentionally overlong name to demonstrate live fail-closed overflow detection!),
  - A rendered preview for checking Arabic diacritics and leading zeros.
  - The gallery offers Workshop Attendance, Clinic Consent, Multi-Page HR Choices, and Landscape Visitor Badge in English and Arabic. Each fixture pair uses a separate local bundle loaded on selection. The primary sample button opens Workshop Attendance.
- **Live In-Browser PDF Preview (`pdfjs-dist` local worker)**:
  - Render PDF pages in a browser-only `<canvas>` with a row switcher and **Fit**, **100%**, **125%**, and **150%** controls. Keep large zoom levels and the page strip in local scrolling containers on desktop and on mobile at 390 px.
  - The page strip uses one 1-based button per page. A red dot and issue count identify pages with flagged widgets. Selecting a flagged row opens its first affected page. Selecting a page button jumps directly to that page. Highlight the failed widgets on the current page and keep that page visible during and after an inline correction.
- **Row-Level Preflight Queue & Inline Fix**:
  - Summary bar: `Total rows` | `Ready (Clean)` | `Flagged (Needs Review)` | `Active Font` | `Min Font Size (6–10pt slider)`.
  - The filterable row table shows field diagnostics. Users can edit a cell inline or adjust the minimum font size where applicable. For `invalid-choice`, show the allowed choices beside the diagnostic and offer a select control for a column with an unambiguous choice mapping.
  - **Clean & replace roster text** above the queue shows the live impact preview for selected columns. Space cleanup is selected inside the panel by default. Each letter and diacritic modification requires an explicit selection, and the batch changes when the operator applies the transform. **Undo last transform** restores the previous effective cell edits and hygiene summaries. A subsequent manual cell edit clears that Undo. [Roster hygiene contract](roster-mapper.md)
  - Search row numbers, filenames and cell values. The `All`, `Ready`, `Flagged` and `Source warnings` filters paginate at 20 rows per page. In the queue and selected-row summary, filenames use `<bdi dir="ltr">` with isolated Unicode stem runs. The stem can wrap while the `.pdf` extension stays at its right edge. The title, selection text, audit and ZIP use the logical filename.
  - Join the roster filename plan to row preflight in the workbench. Use its exact names in the queue, ZIP, audit, and merged-PDF cover. Show a localized disclosure for each adjusted name. Changing only the filename pattern updates the plan without rechecking the PDFs. An export uses the plan at the start of the download.
  - Press `/` outside form fields to focus search. Within an active row editor, `Escape` restores the row overrides from the start of that edit and focuses the row's edit button. Keep visible keyboard outlines at least 2 px and announce batch phase and counts politely.
  - Source warnings show spreadsheet cell coordinates. Mapped Excel formula cells warn whether a stored result is present, so the operator can verify stale results or enter a verified value for an empty cell.
  - Show a proven font-size threshold or MaxLen excess beside the red preview highlights and in the selected row editor. Offer `Set min font to X pt` when each failure in the selected row can be resolved within the 6 pt floor. Changing that setting checks the full batch again.
  - The batch suggestion counts rows that can be resolved by a size change alone and uses their highest shared passing floor. Applying it reruns preflight for all rows. The Landscape Visitor Badge fixture demonstrates the action. Other diagnostics remain subject to review.
- **Local Worker Lifecycle**:
  - A dedicated, first-party Web Worker runs preflight, ZIP creation and merged PDF creation. It retains the PDF bytes between operations and sends row metadata, the requested single-row preview, and the completed file back to the interface.
  - Show the current phase and completed/total count. `Cancel batch` terminates the worker and clears the results and pending downloads. `Resume batch` rechecks the retained files and edits in a fresh worker. Replacing inputs or editing preflight settings also invalidates the previous worker.
- **Local Mapping Presets**:
  - The mapping panel tags text, checkbox, radio group and dropdown fields. Supported editable fields can be mapped. `Leave unchanged` is the default for dropdowns and radio groups. Show template choice labels and, when different, their export values.
  - Mapped text fields expose **Align** with **Auto**, **Right (RTL)**, **Left (LTR)**, and **Center**. Alignment selection reruns preflight. [Text layout contract](pdf-engine.md)
  - The local JSON preset stores field-to-column `mapping`, `filenamePattern`, `minFontSize` (6–10 pt) and bundled `font` (`auto`, `arabic` or `latin`). An explicit alignment other than `auto` saves version 4 with `alignOverrides` keyed by canonical field name, and booleans for `flattenZip` and `includeCoverSheet`. With every mapped text field on `auto`, the enabled cover saves version 3 with both output booleans. With the cover off, save version 1 for editable ZIP or version 2 with `flattenZip: true`. Version 1 imports restore editable ZIP. Version 2 imports require a boolean `flattenZip`. Versions 1 and 2 restore the cover setting to off, and versions 1–3 restore Auto alignment. Validation rejects extra keys. The importer skips unavailable fields and columns, reports mismatches, and can accept a preset before source files are chosen.
  - Custom TTF/OTF bytes stay in this tab's memory. The picker rejects files above 16 MiB before reading them. Output Settings displays the parsed family name and preflight glyph coverage feedback. Selecting a replacement invalidates existing results immediately. Loading or rejecting a font disables exports until a valid font is selected or the custom font is cleared. Clearing it uses the selected bundled font. A valid preset import uses its bundled font setting and clears a prior custom selection.
- **Export Controls**:
  - `Download Clean PDFs (.zip)` exports only ready rows. The ZIP contains one editable PDF per record by default. The EN/AR **Output settings** checkbox changes it to one flattened PDF per record for printing or sharing. Flattened copies carry widget appearances onto the page and remove the interactive form controls. For `unflattenable-widget`, offer editable ZIP or a template with saved field appearances. Verify the actual recipient viewer or print path separately.
  - `Download Merged Printable PDF` combines ready rows into one flattened file for printing. The localized **Include printable cover sheet in Merged PDF** checkbox in **Output settings** defaults to off. When enabled, the export sends the active locale, template name, and full filename plan to the worker. See the [cover contract](pdf-engine.md).
  - `Download Preflight Audit (.csv / .json)`
- **Privacy and recurring batches**
  - The `Browser-local` badge describes the local processing and production `CSP: connect-src 'none'`. Verify network behavior in DevTools.
  - `Download scope checklist` is a planning aid for recurring batches. The landing claim gate rules apply to any future pricing or customer evidence.

## Local Batch Drafts

- **Save Draft (.json)** downloads a versioned local file with the effective cell edits, including transformations, the applied hygiene summaries, and mapping and output settings. Draft settings use the v4 schema. A draft may contain roster cell values. Source PDF, roster, and font bytes are supplied locally when restoring. The draft is persisted in the downloaded file only, with no cloud storage or `localStorage`.
- **Load Draft (.json)** validates the JSON before applying settings. The active PDF and roster must match the stored SHA-256 fingerprints and the expected fields, worksheet, ordered columns, and row count. If the draft used a custom font, the selected font bytes must also match the stored SHA-256 fingerprint. A mismatch reports a local error before applying draft changes.

## Static Pre-Rendered SEO Routes (Strictly <= 5 per `SEO完整策略.md`!)
1. `/` — Main workbench for filling AcroForm PDFs from CSV or Excel.
2. `/arabic-pdf-form-filler` — Focused English landing page (`fill pdf from csv arabic`, comparison against WinAnsi/clipping failures)
3. `/ar/pdf-mail-merge` — Clean Arabic RTL landing page (`dir="rtl"`, concise verified Arabic UI/copy, clearly marked for native reader verification before launch)
4. `/preserve-leading-zeros-pdf` — Focused page on preserving `00123` / `00007` IDs from CSV & Excel into PDFs
5. `/privacy-and-proof` — Browser-local processing and supported PDF types, with steps to inspect a synthetic row, correct its field, and compare the PDF preview.

The English Arabic PDF guide and the Arabic mail merge guide offer an interactive comparison with a clipped baseline and ink-bounds placement. Both states use the labeled synthetic specimen `بَنِي يَمَن / سَلْمَى بِنْت يَاسِين`. The controls support pointer and keyboard input. The web display uses local assets and the actual batch PDF engine and embedding font data load only when needed. The page summaries and guide copy are authored in `scripts/prerender.mjs` and carried into the workbench from the static page.

## Cloudflare Pages Production Readiness
- Build outputs `dist/_headers` with `Content-Security-Policy` including `connect-src 'none'`, `worker-src 'self'` and `form-action 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- Check that `dist/` contains precisely the five HTML routes above with JSON-LD and no named `<form>` elements. The Arabic route declares `lang="ar" dir="rtl"`. `dist/sitemap.xml` and `dist/robots.txt` use the `SITE_URL` origin, with `https://arabiform.example` as the local default.
- CI runs `npm run verify:release` immediately after `npm run build`. The gate checks the five routes, sitemap, response headers, included license notices, and each route's entry JavaScript budget of under 300,000 raw bytes and 95,000 gzip bytes.
