# Subsystem: Roster Ingestion & Auto-Mapping (`src/core/roster/`)

## Responsibilities
- Pure browser- and Node-compatible TypeScript module.
- Accepts `.csv` (UTF-8, UTF-8 BOM, Windows-1252, UTF-16LE via native `TextDecoder` + `papaparse`) AND `.xlsx` (via MIT pure-JS parser e.g. `read-excel-file` or `xlsx` / `fflate`-based OOXML sharedStrings+sheet reader with strict **string/formatted-text extraction** and multi-sheet selector!).
- **Strict Leading-Zero Protection**:
  - CSV: Parse all cells strictly as strings (`dynamicTyping: false`). Never coerce `"00123"` -> `123`.
  - XLSX: Read formatted string/raw text cells without stripping leading zeros; detect and surface an explicit warning (`excel-scientific-notation-warning`) if an Excel cell already contains corrupted scientific notation (`1.23457E+11`) or numeric cells in an ID/phone/zip column so users catch Excel damage before printing!
- **Smart Auto-Mapper**:
  - Automatically propose column -> PDF field mappings using normalized exact match + bilingual Arabic/English alias table (`Name / Full Name / الاسم / الاسم الكامل`, `ID / Number / Badge / Employee ID / الرقم / رقم الهوية`, `Date / التاريخ`, `Title / Course / الدورة`, etc.).
  - Never silently overwrite user-adjusted mappings; allow 1-click clear/remap.
- **Safe Filename Templating**:
  - Build output filenames from `{{ColumnName}}` tokens, stripping illegal filesystem characters (`/\:*?"<>|`), preserving Arabic/Unicode characters cleanly, capping length, and deterministically resolving duplicates (`name.pdf`, `name-2.pdf`).
