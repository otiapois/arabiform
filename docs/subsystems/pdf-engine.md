# Subsystem: PDF & Font Shaping Engine (`src/core/pdf/`)

## Responsibilities
- Pure browser- and Node-compatible TypeScript module (`src/core/pdf/`) with zero external network calls.
- Reference proven baseline algorithm from `D:\workspace\vibe_coding\sites\import-medic\docs\research\M1.5\02-evidence\acroform-baseline.cjs` and evolve it to production quality:
  1. **Strict PDF Intake Gate**:
     - Inspect raw AcroForm dictionary BEFORE `getForm()`.
     - Reject `/XFA` (`xfa-unsupported`), encryption (`encrypted-pdf`), and signature fields (`signed-pdf-warning`) before accessing the form. `flat-scanned-no-fields` means the PDF has no editable text or checkbox field. An editable checkbox-only AcroForm can be filled.
     - Field metadata exposes the canonical name, kind, editability, existing value, and every widget's rectangle, page and rotation. Text metadata also includes `maxLength`, multiline and default appearance font size. Radio groups and dropdowns appear as read-only.
  2. **Bundled Local Fonts (`public/fonts/`)**:
     - Bundle OFL-licensed `Noto Naskh Arabic` (Regular) + `Noto Sans` (Regular) locally so both pure Arabic (with harakat/diacritics), pure Latin/numeric IDs (`00123`), AND mixed Arabic+Latin/digits work 100% offline with zero external requests!
     - A local custom font can be passed as `PreflightOptions.customFont` (maximum 16 MiB). `inspectCustomFont` validates its SFNT structure and reports the internal family name. Supported outlines are TrueType and OpenType CFF v1. Multi-dictionary CID-keyed CFF fonts and CFF2 are unsupported. Corrupt or unsupported fonts return `invalid-custom-font`. Mapped text uses only the selected custom face and flags missing coverage as `missing-glyphs`. The worker reuses the parsed face and embeds the shaped glyphs in each output.
  3. **True Ink-BBox Shaping & Auto-Baseline**:
     - Shape Arabic runs via `@pdf-lib/fontkit` after ordering mixed text with `bidi-js`. Keep numeric IDs with `#` and international phone groups with `+` left-to-right using layout-only isolates. Preserve Arabic-Indic digits, paired brackets, and the exact logical source in `/V`.
     - Flag authored directional overrides and isolates and unsafe or unsupported joining controls. Preserve a contextual Arabic ZWJ or ZWNJ when the bundled font can shape it. Flag malformed Unicode, unsupported control characters, and missing glyphs before writing a PDF.
     - Calculate true ink bounding box (`yMin`, `yMax`, total advance width) across all glyphs including descenders (`ن`, `ى`, `ي`, `م`, `ق`) and diacritics.
     - Auto-fit font size within `[options.minFontSize (default 8pt, user adjustable 6–10pt), templateFontSize || 12pt]` against inner box (`width - 2*pad - 2*border`, `height - 2*pad - 2*border`).
     - Vertically center true ink (`yMin..yMax`) inside the widget rect to guarantee **zero top/bottom clipping**.
     - Support single-line AND multiline wrapping (when field has multiline flag, wrap by word boundaries and check total line height against inner height; flag overflow if it exceeds box height!).
     - Multi-widget atomicity: if a canonical field appears on multiple pages/widgets, verify ALL widgets fit; if any widget fails, flag the field fail-closed!
     - Checkbox mapping trims whitespace and accepts case-insensitive `true/false`, `yes/no`, `1/0`, `x`/blank, and `نعم/لا`. Any other cell value yields `invalid-checkbox-value`. A mapped checkbox reuses the original on and off appearance streams across all widgets. Missing or inconsistent states yield `unsupported-checkbox-appearance` before any PDF is written.
  4. **Row-Level Batch Execution & Outputs**:
     - For each roster row, return deterministic `RowPreflightResult`: `status: 'pass' | 'flagged'`, per-field diagnostics with every failed widget index where applicable, computed font sizes, and rendered bytes when passing.
     - A size-limited widget includes `requiredFontSizePt` when the actual ink placement fits at a smaller floor of at least 6 pt. The value is an already tested size on the 0.01 pt grid. Apply the minimum of all suggestions only when every row diagnostic contains one. `/MaxLen` flags include `maxLengthExcess` counted in Unicode code points. Comb fields remain unsupported even when their values meet `/MaxLen`.
     - The browser uses `src/core/worker/client.ts` to run preflight and both exports in one dedicated, locally bundled module worker per batch. Row results carry diagnostics and sizes. The worker retains ready PDF bytes and transfers the selected preview copy and final ZIP or merged PDF. Progress carries phase and completed/total row counts. Disposing the worker immediately cancels CPU work and rejects pending requests with `AbortError`.
     - Support **two batch export modes**:
       1. **Individual PDFs in `.zip`** (`fflate` MIT) with customizable sanitized filename pattern (e.g. `{{ID}}-{{Name}}.pdf`, deduplicating collisions with `-2`, `-3`).
       2. **Merged Single Printable PDF** (combining all passing rows into one multi-page print-ready PDF — flattening or renaming AcroForm field names uniquely per copy so rows never overwrite each other when merged!).
     - **Untouched Field Invariance**: Individual editable PDFs preserve raw `/V`, `/AS`, and `/AP` for unmapped widgets and fields. The merged printable export flattens the active appearances and is checked against the individual pages at 4×.
     - **Audit Report**: Export deterministic `.json` and `.csv` preflight audit logs with row index, filename, status, field font sizes, and flag reasons. CSV escapes formula-like cell prefixes, including Unicode compatibility forms and prefixes after leading whitespace or formatting controls. JSON retains exact strings.
