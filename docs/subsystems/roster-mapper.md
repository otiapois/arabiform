# Subsystem: Roster Ingestion & Auto-Mapping (`src/core/roster/`)

## Responsibilities
- Pure browser- and Node-compatible TypeScript module.
- Accepts `.csv` via native `TextDecoder` and `papaparse`. Encodings include UTF-8 with or without a BOM, Windows-1252, UTF-16LE, and BOM-marked UTF-16BE. The `.xlsx` reader uses `fflate` and `fast-xml-parser` to read OOXML cells and workbook sheets, preserving source text and supported number formats.
- **Strict Leading-Zero Protection**:
  - CSV: Parse all cells strictly as strings (`dynamicTyping: false`). Never coerce `"00123"` -> `123`.
  - XLSX: Read formatted string/raw text cells without stripping leading zeros; detect and surface an explicit warning (`excel-scientific-notation-warning`) if an Excel cell already contains corrupted scientific notation (`1.23457E+11`) or numeric cells in an ID/phone/zip column so users catch Excel damage before printing!
  - XLSX formula cells emit an independent `excel-formula-warning` with the actual sheet row and column, even when another warning applies. The workbench shows formula warnings for mapped columns. The parser reads the stored result verbatim under the existing type and format rules, or an empty cell when the cache is absent. It never evaluates formulas.
- **Opt-In Column Hygiene and Literal Find & Replace** (`src/core/roster/hygiene.ts`)
  - Choose one or more columns in the active worksheet. Preview exact counts of affected rows and cells, with up to five before-and-after cell samples. Applying a transform updates the in-memory values used for preflight and export.
  - `normalizeSpaces` removes U+200B and U+FEFF, trims leading and trailing whitespace, converts NBSP to an ordinary space, and collapses repeated whitespace. Preserve U+200C (ZWNJ) and U+200D (ZWJ).
  - Letter changes and diacritic removal are individually opt-in. `normalizeAlef` maps `أ`, `إ`, and `آ` to `ا`. `normalizeTaaMarbuta` maps `ة` to `ه`. `normalizeAlefMaqsura` maps `ى` to `ي`. `stripHarakat` removes U+064B–U+065F and U+0670.
  - Find and replace runs after cleanup and takes literal strings. Case matching is on by default. An empty replacement deletes matches. Cell values stay strings across preview, apply, and Undo. Undo restores the full pre-apply snapshot, including earlier inline edits and IDs such as `00123`.
- **Smart Auto-Mapper**:
  - Automatically propose column -> PDF field mappings using normalized exact match + bilingual Arabic/English alias table (`Name / Full Name / الاسم / الاسم الكامل`, `ID / Number / Badge / Employee ID / الرقم / رقم الهوية`, `Date / التاريخ`, `Title / Course / الدورة`, etc.).
  - Never silently overwrite user-adjusted mappings; allow 1-click clear/remap.
  - Keep dropdown and radio cell values as supplied by the roster. Header matching uses its own normalization. The PDF engine matches choice values against the template's Unicode labels and exports, and reports invalid or ambiguous cells. [Choice matching contract](pdf-engine.md)
- **Virtual Columns** (`src/core/roster/virtual-columns.ts`)
  - Values are strings. `ROW_INDEX` is the original 1-based parsed roster position. `PADDED_ROW_001` pads that position to at least four digits (`0001`, `0500`, `10000`). Search, filtering, flagged rows, and selective export leave the position unchanged.
  - `TODAY_ISO` uses the local Gregorian day in `YYYY-MM-DD`. `TODAY_AR` uses the same day and separators with Arabic-Indic digits, for example `٢٠٢٦-١١-٢٧`. The caller supplies the captured day, so filenames, preflight, preview and PDF export can reuse the same value for a loaded roster.
  - An optional text-field formatter contains exactly one token for the selected virtual column with literal text before or after it, for example `CERT-{{PADDED_ROW_001}}`. The result goes through the same length and ink-fit checks as a roster cell.
- **Safe Filename Templating**:
  - Build single-component PDF filenames from exact roster headers in `{{ColumnName}}` tokens and virtual values in `[[@ROW_INDEX]]`, `[[@PADDED_ROW_001]]`, `[[@TODAY_ISO]]`, and `[[@TODAY_AR]]`. For instance, `{{ROW_INDEX}}` still addresses the roster header `ROW_INDEX`. Remove separator, control, and format characters, guard Windows device stems even before an extension, and retain display text in NFC. Limit generated stems to 180 UTF-8 bytes at grapheme boundaries before adding the collision suffix and `.pdf`.
  - Deduplicate with a compatibility-normalized, case-insensitive key (`name.pdf`, `name-2.pdf`). ZIP independently rejects unsafe components, normalized duplicates, and names above 255 UTF-8 bytes.
  - Use the full batch filename plan in the queue, ZIP, audit, and optional merged-PDF cover index. An exported row keeps the filename and collision suffix from that plan for any subset.
