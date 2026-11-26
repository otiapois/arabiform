# Subsystem: Local Workbench, Live PDF Preview & Static SEO (`src/web/`)

## Workbench UX Standards
- **Synthetic demo** — **Try Synthetic Arabic Sample** loads a sample clearly labeled `Synthetic Sample` under the P0 landing claim gate:
  - A fillable synthetic AcroForm template,
  - A synthetic bilingual Arabic roster (`ليلى حسن / 00123`, `أحمد سالم / 00007`, `بَنِي يَمَن / 00891`, plus 1 intentionally overlong name to demonstrate live fail-closed overflow detection!),
  - A rendered preview for checking Arabic diacritics and leading zeros.
- **Live In-Browser PDF Preview (`pdfjs-dist` local worker)**:
  - Render actual generated PDF pages directly to `<canvas>` inside the browser (zero external upload!) with row switcher (`Row 1 / 2 / 3...`), zoom/fit toggle, and visual red highlight boxes over any flagged fields!
  - Selecting a flagged row starts at its first affected page, using the 1-based page numbers from preflight. The preview header offers a button for each affected page with its issue count. Highlight the failed widgets on the current page and keep that page visible during and after an inline correction.
- **Row-Level Preflight Queue & Inline Fix**:
  - Summary bar: `Total rows` | `Ready (Clean)` | `Flagged (Needs Review)` | `Active Font` | `Min Font Size (6–10pt slider)`.
  - The filterable row table shows field diagnostics. Users can edit a cell inline or adjust the minimum font size where applicable. For `invalid-choice`, show the allowed choices beside the diagnostic and offer a select control for a column with an unambiguous choice mapping.
  - Search row numbers, filenames and cell values. The `All`, `Ready`, `Flagged` and `Source warnings` filters paginate at 20 rows per page. In the queue and selected-row summary, filenames use `<bdi dir="ltr">` with isolated Unicode stem runs. The stem can wrap while the `.pdf` extension stays at its right edge. The title, selection text, audit and ZIP use the logical filename.
  - Source warnings show spreadsheet cell coordinates. Mapped Excel formula cells warn whether a stored result is present, so the operator can verify stale results or enter a verified value for an empty cell.
  - Show a proven font-size threshold or MaxLen excess beside the red preview highlights and in the selected row editor. Offer `Set min font to X pt` when each failure in the selected row can be resolved within the 6 pt floor. Changing that setting checks the full batch again.
- **Local Worker Lifecycle**:
  - A dedicated, first-party Web Worker runs preflight, ZIP creation and merged PDF creation. It retains the PDF bytes between operations and sends row metadata, the requested single-row preview, and the completed file back to the interface.
  - Show the current phase and completed/total count. `Cancel batch` terminates the worker and clears the results and pending downloads. `Resume batch` rechecks the retained files and edits in a fresh worker. Replacing inputs or editing preflight settings also invalidates the previous worker.
- **Local Mapping Presets**:
  - The mapping panel tags text, checkbox, radio group and dropdown fields. Supported editable fields can be mapped. `Leave unchanged` is the default for dropdowns and radio groups. Show template choice labels and, when different, their export values.
  - The local JSON preset stores field-to-column `mapping`, `filenamePattern`, `minFontSize` (6–10 pt) and bundled `font` (`auto`, `arabic` or `latin`). Editable ZIP exports save a version 1 preset. With flattened ZIP enabled, save version 2 and `flattenZip: true`. A version 2 import requires a boolean `flattenZip`. Importing version 1 restores editable ZIP. Import validates the entire file, skips unavailable fields and columns, and reports mismatches. Presets can be imported before source files are chosen.
  - Custom TTF/OTF bytes stay in this tab's memory. The picker rejects files above 16 MiB before reading them. Output Settings displays the parsed family name and preflight glyph coverage feedback. Selecting a replacement invalidates existing results immediately. Loading or rejecting a font disables exports until a valid font is selected or the custom font is cleared. Clearing it uses the selected bundled font. A valid preset import uses its bundled font setting and clears a prior custom selection.
- **Export Controls**:
  - `Download Clean PDFs (.zip)` exports only ready rows. The ZIP contains one editable PDF per record by default. The EN/AR **Output settings** checkbox changes it to one flattened PDF per record for printing or sharing. Flattened copies carry widget appearances onto the page and remove the interactive form controls. For `unflattenable-widget`, offer editable ZIP or a template with saved field appearances. Verify the actual recipient viewer or print path separately.
  - `Download Merged Printable PDF` combines ready rows into one flattened file for printing.
  - `Download Preflight Audit (.csv / .json)`
- **Privacy and recurring batches**
  - The `Browser-local` badge describes the local processing and production `CSP: connect-src 'none'`. Verify network behavior in DevTools.
  - `Download scope checklist` is a planning aid for recurring batches. The landing claim gate rules apply to any future pricing or customer evidence.

## Static Pre-Rendered SEO Routes (Strictly <= 5 per `SEO完整策略.md`!)
1. `/` — Main workbench for filling AcroForm PDFs from CSV or Excel.
2. `/arabic-pdf-form-filler` — Focused English landing page (`fill pdf from csv arabic`, comparison against WinAnsi/clipping failures)
3. `/ar/pdf-mail-merge` — Clean Arabic RTL landing page (`dir="rtl"`, concise verified Arabic UI/copy, clearly marked for native reader verification before launch)
4. `/preserve-leading-zeros-pdf` — Focused page on preserving `00123` / `00007` IDs from CSV & Excel into PDFs
5. `/privacy-and-proof` — Interactive visual proof (`connect-src 'none'`, before/after unclipped Arabic rendering proof, honest supported vs unsupported PDF matrix: ordinary AcroForm YES vs XFA/scanned/signed NO).

The English Arabic PDF guide and the Arabic mail merge guide explain ink-bounds preflight using the same fictional name from the sample roster. Their page summaries and guide copy are authored in `scripts/prerender.mjs` and carried into the interactive workbench from the static page.

## Cloudflare Pages Production Readiness
- Build outputs `dist/_headers` with `Content-Security-Policy` including `connect-src 'none'`, `worker-src 'self'` and `form-action 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- Check that `dist/` contains precisely the five HTML routes above with JSON-LD and no named `<form>` elements. The Arabic route declares `lang="ar" dir="rtl"`. `dist/sitemap.xml` and `dist/robots.txt` use the `SITE_URL` origin, with `https://arabiform.example` as the local default.
