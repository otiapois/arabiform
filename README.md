# ArabiForm

ArabiForm creates reusable AcroForm templates, fills interactive PDFs from CSV or Excel (`.xlsx`), and combines multiple forms into a printable PDF for each person. It also extracts saved field values and compares delivered PDFs or QR text with supported custody manifests. The browser workbench and the local CLI process files on your device. [اقرأ بالعربية](#العربية)

## Create a starter template

1. On `/` or `/ar/pdf-mail-merge`, open **Create template**. Choose **Bilingual Certificate** (A4 landscape), **HR Employment Letter** (A4 portrait), **Clinic Consent Form** (A4 portrait), or **A6 Visitor Badge** (landscape).
2. Set the organization name, subtitle, accent palette, and Arabic, English, or bilingual header. Check the generated PDF in the preview.
3. Choose **Download AcroForm Template (.pdf)** for a reusable interactive PDF and **Download Starter CSV** for a roster with matching headers and fictional sample rows. **Use in Fill PDFs Now** opens the generated PDF in the usual fill workflow and keeps your current roster, if one is loaded.

## Design fields

1. On `/` or `/ar/pdf-mail-merge`, open **Design fields**. Choose a flat PDF or select **Try Synthetic Flat Certificate Demo**. If you chose an eligible flat source in **Fill PDFs**, use **Open in Visual Field Designer** on the intake warning to carry the file over.
2. In the designer, select a page, pick **Text field**, **Checkbox**, **Dropdown**, or **Radio**, and drag on the preview to place it. Select a box to edit its name, position, and size. Use the arrow keys to move a focused box or hold Shift for a larger step. For a text field, you can set alignment, font size, multiline, and maximum length. For a **Dropdown**, enter one distinct option per line in **Options (one per line)** and select **Apply options**. For a **Radio**, set its **Group name** and **Export value**. To add another button to the same group, leave a button from that group selected while you place the next one. Give each button in the group a distinct export value and map the group's shared field to one roster column.
3. Choose **Save Field Layout (.json)** to keep the field settings and coordinates for later. To resume, open the original flat PDF and choose **Load Field Layout (.json)**. The designer compares the SHA-256 of the current PDF's exact bytes with the fingerprint in the layout. Keep the source PDF and the JSON together. A file with the same name or visual appearance can still have different bytes.
4. Choose **Download AcroForm Template (.pdf)** to keep a reusable interactive PDF, or **Use in Fill PDFs Now** to take it directly into the fill workbench. Load a CSV or Excel roster, choose the worksheet if applicable, and map its columns. Review Arabic and mixed-script names in PDF preview. Fill checks the actual shaped letters and diacritics against the field bounds and flags values that exceed the space or the configured length.

Design adds fields on top of the original page artwork, including on a scan saved as PDF. Placement is manual and the scan serves as the background. Use a flat source without existing interactive fields or widgets. Encrypted, signed, and XFA files are blocked. Source files, field layouts, and template generation are processed locally.

Save the layout to reuse dropdown options, radio group names and export values, and each widget's placement. To extract the selected values after filling, use the editable PDFs from the individual ZIP.

## Extract filled PDFs

On `/`, select **Extract PDFs → CSV / .xlsx**. Drop or choose 1–200 PDFs, or select **Try Synthetic Arabic Filled-PDFs Demo** to generate three fictional examples locally. Use PDFs with saved interactive form fields. Flattened exports and scans without form fields get their own blocked rows, as do encrypted, signed, XFA, and unreadable PDFs. The table uses the combined field names in first-seen order. Review each file's status for missing or additional fields and field type changes compared with the first readable form.

Use **Download CSV** for a UTF-8 file with a byte order mark (BOM) and formula-like cells escaped. If importing CSV into Excel, set ID columns to Text to keep leading zeros. Use **Download .xlsx** for explicit text cells that preserve `00123`, Arabic diacritics, and mixed-script punctuation. Each checkbox has a `checked` or `unchecked` value and a separate column with its native PDF value. Choice fields include their export value and a separate label where it differs.

**Download Custody JSON** saves the original filenames, extraction statuses, exact field values, and full SHA-256 hashes for each source PDF and the generated CSV and Excel files. Compare a file's hash with the digest in a trusted copy of the receipt to check that its bytes match. The receipt is unsigned.

## Verify a batch receipt

1. On `/` or `/ar/pdf-mail-merge`, open **Verify receipt**. Choose the batch custody JSON you saved from **Fill PDFs**, or the `batch-custody.json` inside a ZIP of split merged PDFs.
2. Add one or more delivered PDFs, paste the text read from a custody QR stamp, or do both. Select **Verify**. For a PDF, ArabiForm computes SHA-256 from the exact file bytes and compares it with the recorded output digest. A matching file is verified. A known filename with a different hash is reported as a byte mismatch. A file without a matching name or hash is reported as unknown.
3. A QR result confirms that the pasted text identifies a row recorded in the supplied receipt. To check the PDF's bytes, supply the PDF itself. Both results depend on the unsigned manifest you provide. Issuer authenticity requires separate evidence.

Earlier batch manifests still support byte checks when they include output hashes. QR record verification requires the optional custody QR mode and the matching post-export receipt.

## Assemble packets

1. On `/` or `/ar/pdf-mail-merge`, open **Assemble packets**. Choose **Try Synthetic 2-Document HR + Consent Packet Demo** to load and check fictional records, or use **Add PDFs** to select two to four fillable AcroForm PDFs. Use **Move earlier** and **Move later** to set the order in every packet. Intake blocks encrypted, signed, XFA, and flat PDFs.
2. Use **Choose CSV or Excel** to select one shared roster. In **Worksheet**, select the visible tab you want if the workbook has more than one. Open each template's tab in **Field mapping** and map at least one editable field to a column. Choose **Leave unchanged** to preserve a field's existing appearance in print.
3. Optionally turn on **Include bilingual cover and table of contents**. It adds an English and Arabic cover to each packet. The index lists each document and its actual first page in the packet. For example, after the cover, a two-page first document starts on page 2 and the next document starts on page 4. Use **Group packets by roster column** for ZIP folders, and **Packet filename pattern** to customize the names. With an `ID` column, the default is `{{ID}}-packet.pdf`. Otherwise the filename uses the original roster row number.
4. Select **Check packets**. A row is **Ready** when every template passes the checks for that person. An invalid choice or text that cannot fit in even one document flags the row and holds its whole packet. Review the template, field, and reason under **Diagnostics**, then correct the inputs and check again. Other ready rows can still be exported.
5. Download **Per-Person Packets (.zip)** and **Packet Custody Manifest (.json)**. The ZIP contains one flattened, print-ready PDF per ready person, in the template order you set. The unsigned `packet-custody-manifest.json` records SHA-256 hashes of the source templates, the shared roster, and each emitted packet. To check a file's bytes, compare its full hash with the digest for that file in a trusted copy of the manifest. Issuer authenticity requires separate evidence. [Packet format and receipt fields](docs/subsystems/pdf-engine.md#multi-template-packet-assembly)

## Compare templates

1. On `/` or `/ar/pdf-mail-merge`, open **Compare templates**. Choose the old and new fillable AcroForm PDFs. Optionally add the old mapping preset (JSON versions 1–13), or select **Try Synthetic 2026 → 2027 Upgrade** to practice with fictional files.
2. Review added and removed fields, type and choice changes, widget widths and heights in PDF points, and changes to `/MaxLen`. A smaller widget or a lower character limit can affect the values you can fill. For preset fields that need remapping, explicitly choose a compatible replacement. Resolve missing or conflicting targets and obsolete options in conditional rules before migrating.
3. Download the **Migration Report** as CSV or JSON to keep the changes, migration diagnostics, and both original PDF fingerprints. When the preset's references pass validation, use **Download Migrated Preset (.json)** to save a copy. Choose **Open New Template & Migrated Preset in Fill PDFs** to check the revised form with the current roster, if one is loaded.

Comparison and migration run locally. A migrated preset preserves its settings version and carries over the supported field mappings, overrides, and rules. Review structural warnings and run the usual roster preflight in **Fill PDFs** before exporting. That step checks actual roster values, including choice membership, character limits, and text fit. [Comparison and migration contract](docs/subsystems/pdf-engine.md#template-version-comparison-and-preset-migration) · [CLI example](docs/subsystems/cli-automation.md#template-comparison-walkthrough--تجربة-مقارنة-القوالب)

## Fill PDFs

Map roster columns, preview Arabic and mixed-script text, and correct flagged rows in your browser before export.

1. Choose an AcroForm PDF with supported editable fields. Open **Inspect template field capacities** before selecting a roster, or choose both files to start filling. **Try Synthetic Arabic Sample** opens Workshop Attendance, which has a deliberately overlong entry. The **Synthetic sample workflows** gallery loads Workshop Attendance, Clinic Consent, Multi-Page HR Choices, or Landscape Visitor Badge when you select it. All four use fictional data.
2. Click a field in the PDF preview, or use `Tab` to reach it and `Enter` or `Space` to activate it. The matching control in **Field mapping** receives focus. Focusing a mapping control highlights its field in the preview and opens its page when needed. Choose a roster column or, for text fields, a locally computed value. Use **Leave unchanged** to keep a field as it is. For checkboxes, use `true`/`false`, `yes`/`no`, `1`/`0`, `x`/an empty cell, or `نعم`/`لا`. Checkbox values are trimmed, and English letter case is ignored. For a dropdown or radio group, copy a label shown in the mapping panel or the PDF's export value when it differs. ArabiForm checks for a unique exact match first, then a unique match after trimming surrounding whitespace. Keep the original Unicode characters, diacritics, and letter case.
3. Search the preflight queue by row number, filename, or cell value. Filter for ready rows, flagged rows, or source warnings. Selecting a flagged row opens its first affected page. Use **Fit**, **100%**, **125%**, or **150%** and select a page number to jump to that page. A red dot marks each page with flagged fields. A value with no match or an ambiguous match flags the row and shows the template's choices. In the row editor, choose a valid option. For a text-length or fit issue, edit the cell or apply the suggested minimum size when offered, then check the preview again.
4. Check the scope under **Download batch**. **All ready (N)** is the default. Check individual ready rows, or use **Select filtered ready** to select all ready matches across every queue page. **Selected only (K)** limits ZIP, merged PDF, preflight audit, and custody manifest to that selection. **Clear selection** empties the subset and disables its downloads. Choose **Use all ready** to return to the default. In **All ready** mode, the CSV and JSON audit still report the entire roster, including flagged rows.

After preflight, use **Longest name**, **Smallest font**, or **First flagged** above the live preview to jump to a row by its original roster number. **Longest name** checks mapped text values and mapped dropdown display labels. Open **Compare two rows** and choose **Row A** and **Row B** to inspect their pages side by side. The previews stack on a narrow screen. For a ready row, the filled preview reports the smallest rendered text size and the minimum clearance from rendered ink to its field edge when mapped text was drawn. Both measurements use points. For a flagged row, the preview shows the template with the affected fields marked and the preflight issues listed.

For an Excel workbook with more than one visible worksheet, use **Worksheet** in **Source files** to choose a tab. ArabiForm lists the exact names in workbook order and opens the first visible worksheet by default. Hidden worksheets are excluded. Switching tabs clears row edits, applied cleanup, and row selection, then checks the new worksheet. The PDF template and output settings carry over. Review the field mapping after switching.

The ZIP contains separate editable PDFs by default. Turn on **Flatten individual PDFs in ZIP (lock fields for print/mobile sharing)** in **Output settings** to make one flattened copy per row. The merged printable PDF combines flattened copies using the selected print layout. Editable copies keep unmapped values and appearances. Flattened copies carry the visible field appearances into the page and remove interactive form controls.

The **Print sheet estimate** in **Download batch** counts each PDF page as one sheet for single-sided printing. It uses the ready rows in the current export scope and includes all enabled cover pages, including index continuations. Eligible one-page templates show 1-up, 2-up and 4-up counts, with savings measured against 1-up. With a grouping column selected, check **Combined PDF** and **Split PDFs by group**. The estimate rounds up the record sheets separately for each group and adds each group's cover pages. With no ready rows in scope, the count is zero. [Sheet counting rules](docs/subsystems/pdf-engine.md#print-sheet-estimation)

**Group exports by a roster column**

1. In **Output settings**, choose a column such as `Branch` under **Group files by column**. The default is **None (single folder)**. When a saved grouping column is absent from the current worksheet, choose an available column or return to **None (single folder)**.
2. Review the folders and ready-row counts under **Download batch**. Empty or whitespace-only values go into `_Ungrouped`. Folder names retain Arabic and Latin text and are made safe for ZIP extraction. If different group values resolve to the same folder name, the later folders receive numeric suffixes. The individual ZIP uses paths such as `Riyadh/00123.pdf` and resolves filename collisions inside each folder. The `zipPath` field shows the planned path in the CSV and JSON preflight audits and the actual path in the standalone custody manifest after export.
3. Choose **Download Split Merged PDFs by Group (.zip)** for one printable PDF per group with ready rows in the current scope, such as `Riyadh-merged.pdf`. Each output can use the selected cover language, including **Bilingual (EN + AR)**, and the cover's counts and page ranges refer to that group. Enabled watermarks, local vector QR stamps, and 2-up or 4-up layouts apply to the record pages of eligible templates. The ZIP includes a root `batch-custody.json` with source fingerprints, scope, group names, original roster row numbers, and the path, byte length, and SHA-256 of each merged PDF. **Download Merged Printable PDF** still provides one combined file.

Use **Download Custody Manifest (.json)** in **Download batch** to save the full SHA-256 hashes of the original PDF template and CSV or Excel file. For Excel, the hash covers the entire workbook. The receipt adds `sheetName` with the exact worksheet name after you switch tabs, even if you switch back to the first visible tab. While you use the worksheet opened by default, the workbook hash and the first-visible rule identify that sheet. CSV uses the existing receipt fields. The receipt identifies the export scope and the original roster positions of the ready rows in scope, starting at 1. After a successful ZIP export, it records each PDF member's name, byte length, and hash. After a successful merged PDF export, it records the hash of that PDF. Download the receipt after the exports you want to compare and before changing the worksheet, selection, or output settings. Expand a source fingerprint to view or copy its full value. Use [Verify receipt](#verify-a-batch-receipt) to compare a delivered PDF or custody QR with the unsigned receipt.

The template inspector lists each field and its widgets, including page, rotation, usable width and height in points, and `/MaxLen` when set. Download the table as CSV to share with whoever prepares the roster. The Arabic and Latin capacity numbers come from shaping representative text with the bundled Noto Naskh Arabic and Noto Sans fonts at the current minimum font size. Arabic samples include diacritics. Text estimates count Unicode code points, including marks and spaces. Actual fit depends on the characters and their combinations. Preflight checks the actual values against every mapped widget.

The **Print-margin advisory** lists mapped widgets whose clearance from the nearest page edge is less than 9 pt (about 3.2 mm). It shows the field name, page, edge, and clearance in points after page rotation. Negative clearance means the widget extends past the edge. Turn on **9 pt margin guide** beside the preview zoom controls to see the inset on the current page. The advisory leaves exports available for ready rows. Check a sample on the printer you plan to use.

The queue shows the final filenames used in the ZIP and preflight audit. Each row keeps its assigned filename when you export a subset. Open **Filename adjusted** for the reason when a name was cleaned up, changed because Windows reserves it, or given a number to avoid a duplicate. Changing the filename pattern updates the queue immediately.

For a text field, choose **Virtual columns (computed locally)** to use the original roster position (`1`, `2`, …), a serial padded to at least four digits (`0001`, `0002`, …), or the local Gregorian date with Western digits (`2026-11-27`) or Arabic-Indic digits (`٢٠٢٦-١١-٢٧`). The date is captured when the roster loads. Filtering, flagged rows, and subset export leave the original numbering in place. Add text around the chosen field token with a format such as `CERT-{{PADDED_ROW_001}}`. The completed value goes through preflight for field length and fit.

In **PDF filename pattern**, use `[[@ROW_INDEX]]`, `[[@PADDED_ROW_001]]`, `[[@TODAY_ISO]]`, or `[[@TODAY_AR]]` for those four values. For example, `CERT-[[@PADDED_ROW_001]]-{{Name}}.pdf` combines a serial with the `Name` column. `{{PADDED_ROW_001}}` in a filename still refers to a roster column of that exact name.

Open **Shortcuts (?)**, or press `?` outside form fields. From outside a form field, `/` focuses search when the queue is visible. Use `↑` and `↓` with focus in the queue table to move through matching rows. `Esc` closes the shortcut dialog and returns focus to where you opened it. In a row editor, `Esc` restores the values from before that edit and returns focus to **Edit row**. The dialog lets you turn off single-character shortcuts for the current page.

To edit roster text in bulk, open **Clean & replace roster text** and select one or more columns. The preview shows the exact number of changed rows and cells and up to five before-and-after examples. Space cleanup is selected by default in the panel and only takes effect when you apply it. It trims and collapses whitespace, replaces non-breaking spaces with ordinary spaces, and removes U+200B and U+FEFF while keeping the Arabic joining controls ZWJ and ZWNJ. Turn on each letter or diacritic change separately. The options convert `أ/إ/آ` to `ا`, `ة` to `ه`, or `ى` to `ي`, or remove Arabic diacritics in U+064B–U+065F and U+0670. Find and replace matches literal text after the selected cleanup, with case matching enabled by default. An empty replacement deletes matches. **Undo last transform** restores the values from before the latest application, including earlier edits and leading zeros such as `00123`. Use it before making a new manual cell edit.

Use **Align** on a mapped text field to select **Auto**, **Right (RTL)**, **Left (LTR)**, or **Center**. Auto keeps the default placement. Right and Left place the rendered text at the chosen edge, and Center uses the actual width of its ink. Arabic and mixed-script shaping remain active with every setting.

Open **Text formatting** on a mapped text field. Under **Digits**, choose **Preserve** to keep the supplied digits, **٠١٢٣** for Eastern Arabic-Indic digits, or **0123** for Western digits. For example, map `00123` to both Notes and ID, choose **٠١٢٣** for Notes and **0123** for ID, and check `٠٠١٢٣` and `00123` in the preview. The rule converts digit characters before checking fit and saving the field value. It keeps leading zeros and applies only to that field. **Line height** offers 1×, 1.15× and 1.3× spacing for multiline text, and **Inner padding** offers 2, 4 or 6 pt or **Template default**. Preflight and PDF rendering use the same settings.

The Landscape Visitor Badge sample demonstrates the batch font-size suggestion. When preflight finds rows that can pass by lowering the minimum size, the button shows how many rows can benefit. Applying it rechecks the full batch. Review any flags that remain before export.

For an eligible one-page template, choose **2-up (2 records per sheet with cut marks)** or **4-Up A4 Grid (up to 75% savings)** under **Merged PDF sheet layout** in **Output settings**. Both layouts apply to the combined PDF and to each merged PDF in the split ZIP. ArabiForm chooses the A4 orientation that fits the largest uniformly scaled records within the margins and gutters. The 4-up grid places up to four records in two rows and two columns. Corner crop marks sit outside the record artwork, and **Center cut guides** adds optional center cutting lines in the gutters. Enabled watermarks, vector QR stamps, and approval seals scale with the record. Output dimensions depend on the scale, so check the cut size and readability on a test sheet.

By default, 4-up fills the slots in roster order across each sheet. Choose **Cut-and-stack order** to keep the original order after cutting a stack of sheets. Keep the sheets in PDF page order, cut the stack into four piles, and collect the piles from top left, top right, bottom left, then bottom right. Skip blank positions. For seven records, the two sheets carry 1, 3, 5, 7 and 2, 4, 6, blank, respectively. Check the printed stack before cutting. Four full slots per sheet use 75% less paper than 1-up for the same one-page records with the cover off. Incomplete sheets, cover pages and separate groups can reduce the savings.

The default is **1-up (standard)**. The browser uses 1-up for multi-page templates. A requested 2-up or 4-up export stops if imposition would drop a visible printable annotation. Use 1-up for that file.

For a print index, turn on **Include printable cover sheet in Merged PDF** under **Output settings**. The cover starts off. Under **Cover sheet language**, choose **Match page** (the default), **English**, **العربية**, or **Bilingual (EN + AR)**. The bilingual cover shows English and Arabic headings and batch statistics side by side on the first page, with one shared index. The cover shows the local export date, template filename, and minimum font size and font mode from preflight. **Ready** counts the rows included in the file, **Flagged** counts rows needing review across the roster, and **Skipped** counts every row left out. The index lists each printed row's original queue number, final filename, and actual page range, including any continuation pages in the numbering.

With 2-up or 4-up, the cover index assigns each record its actual sheet number, including in cut-and-stack order. For example, with one cover page and three records at 2-up, the first two records point to sheet 2 and the third points to sheet 3.

To print short source fingerprints at the bottom of the cover, turn on **Include source fingerprints on cover sheet** after enabling the cover. Each fingerprint shows the first 12 hexadecimal characters. The option starts off and applies in the current tab. Use the full hashes in the JSON receipt to verify file bytes.

In **Output settings**, use **Print watermark (optional)** to choose `DRAFT`, `CONFIDENTIAL`, `مسودة`, `سري`, or custom text up to 32 characters. The default is **None**. Choose −45°, 0°, or 45° and adjust the opacity from 10% to 25%. An enabled stamp starts at 45° and 14% opacity. ArabiForm checks that its bundled fonts can render the stamp before exporting. The stamp applies to form pages in the merged printable PDF and flattened PDFs in ZIP.

Open **Print QR stamp (optional)** in **Output settings**, choose a corner, and enter a pattern such as `CERT-{{ID}}` or `CERT-[[@PADDED_ROW_001]]`. The live preview follows the selected row and uses its current cell values, including edits. The default size is 48 pt. The 36–72 pt white square includes the four-module quiet zone and stays 9 pt from the two edges at the chosen corner. The stamp appears on each record page of the merged printable PDF and flattened PDFs in ZIP. Choose **None** to turn it off.

Keep the resolved text within 106 bytes for ASCII or 105 UTF-8 bytes if it contains non-ASCII text. A missing or malformed token, empty payload, invalid Unicode, or overlap with a visible form field blocks the requested stamped export. The stamp carries the resolved text in the QR itself.

To make a QR verifiable against the batch receipt, select a corner and enable **Use custody QR record**. The stamp then carries a source digest prefix and the original roster row number. It carries no roster cell values. After exporting, save the custody manifest alongside the stamped files. The mode starts off. Existing custom QR patterns and saved settings continue to work.

Open **Official approval seal (optional)** in **Output settings** and turn on **Add official approval seal**. Enter an English label, an Arabic label, and a Gregorian issue date (`YYYY-MM-DD`), then select a corner. Each label allows up to 32 Unicode code points. The selected ready row’s PDF preview shows the double-line vector seal on its record pages. ArabiForm blocks the print export if the seal cannot fit or would overlap a visible field or QR stamp. Try another corner or disable the seal.

The seal appears on record pages in flattened ZIP members and merged printable PDFs, including split, 2-up and 4-up output. The editable ZIP retains interactive fields. The seal is page artwork. A digital signature or proof of issuer identity requires separate evidence.

Print-locked refers to removing the interactive form controls. The resulting files are ordinary PDFs and can still be modified with PDF-editing tools. If a visible field lacks a usable saved appearance, use the editable ZIP or a template with saved appearances. Before sending or printing a batch, open a test copy in the actual viewer or sharing app and check the Arabic text, selections, and page order. PDF.js and PyMuPDF checks cover specific files and display paths. A handoff through iOS, macOS Preview, WhatsApp, or a printer needs its own check.

Keep IDs such as `00123` stored as text. Check the source warnings for numeric Excel cells that may already have lost digits or leading zeros. For a mapped formula cell, ArabiForm uses the result cached in the workbook, or a blank value if the cache is missing. Review the warning and recalculate the workbook or replace the formula with a verified value before printing.

Under **Output settings**, keep the bundled Noto fonts or choose a local file with **Custom font (.ttf / .otf)**. The workbench flags fields whose text needs glyphs missing from the selected font. Review the actual PDF preview for each new template and font. **Clear** switches back to the bundled font setting. Font bytes stay in the current tab during processing and can be embedded in the PDFs you generate.

Export a local JSON mapping preset to reuse field mappings, the filename pattern, the minimum font size, the bundled font setting, and the output options. Active data validation rules use version 13. Versions 1–12 still load with their existing settings. Without data validation rules, 4-up settings use version 12, active conditional rules use version 11 when 4-up settings are absent, and simpler presets keep their earlier versions. Presets recalculate virtual dates when the roster loads. After importing, select a custom font again if you need one. [Preset versions and defaults](docs/subsystems/web-preview-seo.md#workbench-ux-standards)

Use **Save Draft (.json)** to keep inline edits, changes from roster cleanup, cleanup summaries, field mapping, and output settings in a local file. This includes data validation, conditional rules, virtual mappings, text formatting, the watermark, the QR stamp, the approval seal, the cover language, the merged PDF sheet layout, and the grouping column. To reopen the draft, select the same PDF and roster files, the same worksheet for Excel, and the same custom font file if used. Then choose **Load Draft (.json)**. ArabiForm checks the original file bytes and the exact worksheet name and reports a mismatch before applying any draft changes. The draft can contain roster cell values. It is stored as the JSON file you save, without a cloud copy or a copy in browser storage.

The workbench displays mixed-script filenames such as `00001-ليلى حسن.pdf` with `.pdf` at the right edge in both interface languages. In the Arabic **Source files** card, the roster hint displays `.xlsx` with the dot on the left. Fill requires supported interactive fields and blocks XFA, signed, and encrypted PDFs. Files, previews, and exports are processed locally on your device. A local Web Worker handles batches of 500 rows in chunks of 25 and reports progress as it works. Cancel stops the active job and releases the worker's intermediate data. The browser still needs enough memory to assemble the finished ZIP or PDF. The memory required depends on the template and the size of the output.

On `/arabic-pdf-form-filler` and `/ar/pdf-mail-merge`, compare a clipped baseline with placement based on the visible boundaries of the letters and marks in the synthetic specimen `بَنِي يَمَن / سَلْمَى بِنْت يَاسِين`. Check your own text in the PDF preview.

See the workbench with synthetic data on [desktop](docs/reports/screenshots/m3/desktop-m3-mixed-widgets.png) and [mobile](docs/reports/screenshots/m3/mobile-m3-mixed.png), the [custom-font controls](docs/reports/screenshots/m3/desktop-m3-custom-font.png), and the [synthetic demo walkthrough](docs/launch/demo-walkthrough.md).

### Offline email drafts

1. In **Fill PDFs**, load the roster, finish preflight, and check whether the scope is **All ready** or **Selected only**. Under **Output settings**, open **Email drafts (.eml)** and choose a **Recipient email column** from the active sheet.
2. Enter **Subject** and **Message**, for example `Certificate / شهادة — {{Name}}`. A token such as `{{Name}}` inserts the current value under that exact column header once. Text coming from a cell is used literally, even if it contains another token. Message text can span multiple lines. Each ready row in scope needs one plain ASCII address such as `layla@example.test`. Missing or malformed recipients, display names, address lists, unknown or malformed tokens, and carriage returns or line feeds in recipients, subjects or attachment filenames block the entire draft pack. Fix the named row or setting and retry.
3. Download **Offline Email Drafts (.zip)**. Each ready row in scope has one `.eml` with one **To** address and the PDF bytes for that row’s current individual ZIP variant, editable or flattened. The ZIP includes the dispatch ledger as CSV and JSON and a custody manifest for the attached PDFs. Use **Dispatch Ledger (.csv)** for a separate copy. The ledger records the original roster row number, recipient, attached filename and SHA-256 of the PDF and draft.
4. Unzip on a trusted device. Match the draft’s recipient and attachment to the ledger, then open or import the draft in your email client. Client handling of `.eml` varies. Check that your client shows an editable draft with the expected attachment before sending. ArabiForm builds files locally without SMTP, mail-provider authorization or automatic sending.

Treat the ZIP and both ledgers as sensitive. They contain recipient addresses, and the drafts also contain message text and the attached PDF. [Dispatch format](docs/subsystems/pdf-engine.md#offline-email-dispatch-pack) · [CLI example with optional Cc](docs/subsystems/cli-automation.md#email-drafts-and-review-masks--مسودات-البريد-وحجب-القيم)

### Redacted review copies

Open **Redacted review** in **Output settings**. Under **Mask for review**, choose **Keep last 4** or **Full mask** for each mapped text field that needs protection. Check the live PDF preview, then export the review copies. **Keep last 4** turns `0012345678` into `******5678`; values of four or fewer graphemes are masked in full. A grapheme is a perceived character, such as an Arabic letter with its combining marks. **Full mask** replaces each grapheme with one ASCII `*`, and empty values stay empty. The mask applies before numeral formatting, shaping, and fit checks. Choose **None** when preparing originals. Review masks are session settings, outside saved mapping presets and batch drafts.

The custody manifest records `redactedReview: true` and the names of fields actually masked in the exported scope. The mask covers the selected PDF fields. Source files, row editing and independently mapped or existing template content can still contain the original data. Keep review filenames free of sensitive values. If the filename pattern uses a protected column, ArabiForm assigns names such as `row-0002.pdf`. Choose other columns for grouping, custom QR text and email recipients or tokens if they reuse a protected column. Review static artwork, other fields, filenames, stamps, messages and any companion files before sharing. [Review mask contract](docs/subsystems/pdf-engine.md#redacted-review-copies)

### Print-shop certificate

After preflight, use **Download Print-Shop Certificate (.pdf)** to save `print-shop-certificate.pdf`, a separate, one-page English and Arabic receipt for the current combined merged print PDF. Keep the ready selection and output settings in place while saving the certificate and `arabiform-merged.pdf` through **Download Merged Printable PDF**. Either download order uses the same merged bytes. The receipt lists filenames and full SHA-256 hashes for the original template, roster and merged output, the included and excluded row counts, the layout, sheet and cover counts, the embedded font inventory, and the smallest rendered size of mapped text after scaling, where measured.

If the bundled fonts cannot draw a filename, the printed page shows a placeholder. The certificate's PDF properties preserve the exact names and embedded font list as JSON in the **Subject** field. Use the full SHA-256 digest on the page to identify the file by its bytes.

“0 clipped fields verified” refers to the ink-fit checks for mapped text in the ready rows included in that PDF. Other rows can still be excluded. The unsigned receipt lets the print shop compare the received merged file's SHA-256 with its recorded digest. Original artwork, trimming, printer output, and issuer identity require separate checks. The receipt is available for successful combined exports with at least one ready row. It is separate from the split PDFs and the custody JSON.

### Data validation

In **Field mapping**, open **Data validation** and select **Add validation rule**. Choose a roster column and rule, then select **Apply rule**. You can validate columns that the PDF does not use. Each active rule checks the current cell value after edits or cleanup and before PDF formatting. When a saved rule's exact column header is missing or renamed, its rows stay flagged until you restore the header or update the rule.

| Rule | What passes |
| --- | --- |
| **Required** | A value containing something besides whitespace. |
| **IBAN (Mod-97)** | Uppercase ASCII letters and ASCII digits, with the supported country's length and format and a valid ISO 13616 checksum. Ordinary display spaces are ignored during validation and kept in the value. A checksum-valid value is held for review if another valid value results from swapping two different adjacent characters. |
| **ISO Date** | A real Gregorian date written with ASCII digits as `YYYY-MM-DD`, such as `2024-02-29`. `2026-02-29` and `2026-04-31` fail. |
| **Exact digits** | The specified count of 1–32 ASCII digits with no spaces or separators. `0012345678` has ten digits. Keep IDs as text to preserve leading zeros. |
| **Email** | One plain ASCII email address, without line breaks, a display name, or a list of recipients. |
| **Allowed list** | A case-sensitive match with a value on the list. Enter one value per line. Choose **Ignore leading and trailing whitespace** to match after trimming. |

Open **Try Synthetic GCC Payroll / IBAN Demo** to replace the current files and settings with one ready row and two flagged fictional rows. In the review queue, edit row 2's `IBAN` from `SA31 0000 0000 0000 0001 0002` to `SA31 0000 0000 0000 0001 0001` and row 3's `Effective Date` from `2026-02-29` to `2026-02-28`. Select **Done editing** and check that the row becomes ready. A flagged row stays out of the PDFs. The CSV and JSON preflight audits identify the original row, exact column, rule, and reason. [Rule and audit details](docs/subsystems/roster-mapper.md#roster-schema-validation) · [Synthetic CLI walkthrough](docs/subsystems/cli-automation.md#roster-validation-walkthrough--تجربة-التحقق-من-بيانات-الجدول)

### Conditional rules

In **Field mapping**, open **Conditional rules** and choose **Add rule**. Pick a mapped PDF field, a roster column, and a condition. Set or clear text, check or uncheck a checkbox, or choose an option already present in a dropdown or radio group. For each row and field, the first matching rule wins. Move a rule up to give it priority. If no rule matches, the field uses its mapped value.

Text comparisons are literal and case-sensitive. A blank test includes cells that contain only whitespace. Numeric comparisons trim surrounding whitespace and compare decimal values exactly. Only numeric cells can satisfy those comparisons. Rules use the current roster values, including inline edits and cleanup. In a text action, a token such as `{{Role}}` inserts the value from the exact roster header once. The new text goes through numeral formatting, the PDF character limit, and the same glyph and fit checks as directly mapped text.

Choose **Try Synthetic VIP/Standard Example** to load two fictional rows. The `VIP` row fills `Name` with `كبار الشخصيات / VIP` and checks `Consent`. The `Standard` row keeps its mapped name and its unchecked consent box. See each rule’s matched-row count and select a row to inspect the PDF preview. The CSV and JSON preflight audits record which rules applied in `ruleApplied`. [CLI example with a version 11 preset](docs/subsystems/cli-automation.md#conditional-rule-walkthrough--تجربة-القواعد-الشرطية)

## Automate batches from the terminal

Use Node.js 24 and its bundled npm. From the source checkout, install dependencies with `npm ci --ignore-scripts`. Setup can use the npm registry or a prepared cache. The CLI processes your files offline after setup, using the bundled Noto fonts and the workbench's PDF engines.

```sh
npm run arabiform-cli -- --mode studio --template certificate-bilingual --out-dir ./arabiform-demo/starter
```

`studio` creates an editable bilingual template and a matching synthetic CSV. Run `preflight` to check a CSV or Excel batch and write diagnostics, `fill` to write editable and flattened ZIPs plus a merged print PDF, `packet` to assemble two to four templates into one flattened PDF per ready recipient, `extract` to read saved form values from 1–200 PDFs, or `verify` to compare PDF bytes or a custody QR record with an unsigned batch receipt. Use `diff-template` to compare template revisions and optionally migrate a saved preset.

In Fill PDFs, export a mapping preset and open **Local CLI command** to copy a strict fill command with the current settings. Pass the JSON with `--preset` to reuse data validation, conditional rules, text formatting, and the print seal in `preflight` and `fill`. `fill --strict` blocks the entire fill export when a row fails. Exit `0` means clean, `2` means flagged or blocked, and `1` means usage or file I/O error. A `packet` run can exit `2` with files for the ready recipients. A `diff-template` run can exit `2` for structural changes while still writing the reports and a valid migrated preset. [CLI walkthrough, options, and output files](docs/subsystems/cli-automation.md)

Use `fill --imposition 4-up --print-certificate` for the merged A4 grid and its separate print-shop certificate. [Synthetic visitor badge example](docs/subsystems/cli-automation.md#4-up-print-shop-walkthrough--تجربة-الطباعة-بأربعة-سجلات-لكل-ورقة)

Use `fill --dispatch-eml` with a recipient column, subject and body templates to add the draft ZIP and both ledgers. Use `--redact-field` with `preflight` or `fill` to check and apply review masks for the current run. [CLI examples for drafts and masks](docs/subsystems/cli-automation.md#email-drafts-and-review-masks--مسودات-البريد-وحجب-القيم)

## Run and verify locally

CI uses Node.js 24, Python 3.13, and `PyMuPDF==1.26.7`. From the repository root, install dependencies and run the CI checks.

```sh
npm ci --ignore-scripts
python -m pip install PyMuPDF==1.26.7
npm run typecheck
npm test
npm run test:fuzz
npm run generate:fixtures -- --check
npm run verify:pixels
npm run build
npm run verify:release
```

The committed synthetic PDFs, CSV, and workbook support offline testing after install. The fixture check compares generated bytes against the tracked copies. See the [fixture guide](fixtures/README.md) for cases and optional public blank-template checks.

For a local run, use `npm run dev`. Use `npm run preview` after a build to serve the production headers at `http://127.0.0.1:4173`. Run `npm run test:e2e` with Microsoft Edge installed. The Edge suite is separate from the CI checks above and uses the installed browser.

The seeded fuzz tests cover roster parsing, worksheet selection, field design, form filling and extraction, mixed-direction text, filenames, fonts, print layout, stamps, custody hashes, and CLI input and failure paths. M26 acceptance requires at least 52,500 deterministic cases with zero discards or crashes, including IBAN digit mutations and adjacent swaps, Gregorian leap years, leading-zero IDs, and saved preset compatibility. The 4× PyMuPDF checks compare rendered fixture output. Inspect a test export with your own templates, PDF viewer and printer before printing a batch. [M26 acceptance criteria](docs/tasks/M26-roster-schema-validator-iban-date-guards.md)

For Windows development, keep the checkout, worktrees, dependencies, and Python environment on `D:`. Direct npm and pip caches to `D:\cache\arabiform\npm` and `D:\cache\arabiform\pip` with their `--cache` and `--cache-dir` flags. Point the local session’s `TEMP` and `TMP` to an existing `D:` directory. If you need a Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`.

## Static build

`npm run build` writes five static routes to `dist/` along with local assets, a sitemap, `robots.txt`, Cloudflare Pages `_headers` and `_redirects`, and license notices. `/ar` and `/ar/` redirect to `/ar/pdf-mail-merge`.

- `/`
- `/arabic-pdf-form-filler`
- `/ar/pdf-mail-merge`
- `/preserve-leading-zeros-pdf`
- `/privacy-and-proof`

Set `SITE_URL` to the intended public origin before building. Run `npm run verify:release -- --strict-origin` with the same `SITE_URL`, or pass that origin after `--strict-origin`. The gate rejects a mismatched origin and any `https://arabiform.example` fallback in the release metadata. Each route's entry JavaScript must be under 274,000 raw bytes and under 85,800 gzip bytes. Serve the files from the origin root with the response headers in `_headers`. The privacy and worker directives are `connect-src 'none'; worker-src 'self'; form-action 'none'`. [PowerShell and POSIX release commands](docs/launch/cloudflare-pages-7day-launch.md#strict-origin-build)

See the [Cloudflare Pages checklist](docs/launch/cloudflare-pages-7day-launch.md), [bilingual changelog](CHANGELOG.md), [project instructions](AGENTS.md), [subsystems](docs/subsystems/README.md), [code standards](docs/code-standards.md), [lessons](LESSONS.md), [v2.6.0 release brief](docs/tasks/M26-roster-schema-validator-iban-date-guards.md), and [earlier milestone briefs](docs/tasks/). [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## العربية

تنشئ أداة ArabiForm قوالب AcroForm قابلة لإعادة الاستخدام، وتملأ النماذج التفاعلية من جدول CSV أو Excel (`.xlsx`)، وتجمع عدة نماذج في ملف PDF قابل للطباعة لكل شخص. ويمكنك استخراج قيم الحقول المحفوظة ومقارنة ملفات PDF المستلمة أو نص رمز QR ببيانات الحيازة المدعومة. تُعالَج الملفات على جهازك سواء استخدمت واجهة المتصفح أو الطرفية.

### إنشاء قالب جاهز للتعبئة

1. افتح `/ar/pdf-mail-merge` واختر «إنشاء قالب». اختر شهادة إتمام (A4 أفقي)، أو خطاب إثبات عمل (A4 عمودي)، أو استمارة موافقة المريض (A4 عمودي)، أو بطاقة زائر (A6 أفقي).
2. أدخل اسم المؤسسة والعنوان الفرعي، واختر الألوان ولغة الترويسة. يمكن أن تكون الترويسة بالعربية أو الإنجليزية أو اللغتين معًا. راجع القالب في المعاينة.
3. نزّل قالب AcroForm التفاعلي وملف CSV أوليًا يحتوي على عناوين الأعمدة المطابقة وصفوف تجريبية ببيانات خيالية. يمكنك فتح القالب مباشرةً في وضع التعبئة. إذا كان هناك جدول بيانات محمّل، يظلّ متاحًا للربط.

### تصميم حقول النموذج

1. افتح `/ar/pdf-mail-merge` واختر «تصميم الحقول». افتح ملف PDF مسطّحًا أو اضغط «جرّب شهادة اصطناعية». إذا اخترت ملفًا مسطّحًا صالحًا في وضع التعبئة، اضغط «افتح مصمّم حقول النماذج» في التنبيه لنقل الملف إلى المصمّم.
2. اختر الصفحة ونوع الحقل، ثم اسحب على المعاينة لوضع حقل نصي أو خانة اختيار أو «قائمة منسدلة» أو «زر اختيار». حدّد الحقل لتعديل اسمه وموضعه وأبعاده. استخدم مفاتيح الأسهم لتحريكه، أو اضغط معها على `Shift` لتحريكه مسافة أكبر. يمكنك ضبط المحاذاة وحجم الخط وتعدّد الأسطر والحد الأقصى للمحارف في الحقل النصي. للقائمة المنسدلة، اكتب كل خيار في سطر مستقل من «الخيارات (خيار واحد في كل سطر)»، ثم اضغط «تطبيق الخيارات». لزر الاختيار، حدّد «اسم المجموعة» و«قيمة التصدير». لإضافة زر إلى المجموعة نفسها، أبقِ أحد أزرارها محدّدًا أثناء وضع الزر الجديد. أعطِ كل زر في المجموعة قيمة تصدير مختلفة، واربط حقل المجموعة المشترك بعمود واحد في الجدول.
3. احفظ تخطيط الحقول بصيغة JSON لإعادة فتحه وتعديل مواضع الحقول لاحقًا. افتح ملف PDF المسطّح الأصلي قبل تحميل التخطيط. يقارن المصمّم بصمة SHA-256 لمحتوى الملف الحالي بالبصمة المحفوظة في التخطيط. احتفظ بالملف الأصلي مع ملف JSON حتى لو كانت لديك نسخة أخرى تحمل الاسم أو المظهر نفسه.
4. اضغط «نزّل قالب AcroForm (.pdf)» لحفظ PDF تفاعلي قابل لإعادة الاستخدام، أو «استخدمه الآن لتعبئة ملفات PDF» لفتحه مباشرةً في وضع التعبئة. اختر جدول CSV أو Excel وورقة العمل عند الحاجة، ثم اربط الأعمدة بالحقول. عاين الأسماء العربية والنص المختلط. يفحص وضع التعبئة حدود الحروف بعد تشكيلها وعلامات التشكيل داخل الحقل، وينبّهك إذا تجاوزت القيمة المساحة المتاحة أو الحدّ المسموح به لعدد المحارف.

يضع المصمّم حقولًا تفاعلية فوق محتوى الصفحات الأصلية. يمكنك استخدام مسح ضوئي محفوظ بصيغة PDF خلفيةً للصفحة ووضع الحقول عليه يدويًا. استخدم ملفًا مسطّحًا خاليًا من الحقول وعناصر النموذج التفاعلية. تُرفض ملفات PDF المشفّرة أو الموقّعة ونماذج XFA. تُعالج الملفات والتخطيطات وتُنشأ القوالب داخل المتصفح.

احفظ التخطيط لإعادة استخدام خيارات القوائم المنسدلة وأسماء مجموعات أزرار الاختيار وقيم تصديرها وموضع كل عنصر. لاستخراج القيم المختارة بعد التعبئة، استخدم ملفات PDF الفردية القابلة للتعديل من أرشيف ZIP.

### استخراج بيانات ملفات PDF المعبّأة

افتح `/ar/pdf-mail-merge` واختر «استخراج بيانات PDF إلى CSV / .xlsx». اسحب أو اختر من ملف PDF واحد إلى 200 ملف، أو اضغط «جرّب ملفات PDF عربية مُعبّأة تجريبياً» لإنشاء ثلاثة أمثلة ببيانات خيالية داخل المتصفح. استخدم ملفات PDF التي تحتفظ بحقول النموذج التفاعلية. يظهر سبب تعذّر الاستخراج أمام كل ملف مسطّح أو ممسوح ضوئيًا يخلو من الحقول، أو ملف مشفّر أو موقّع أو تالف أو يحتوي على نموذج XFA. يجمع الجدول أسماء الحقول بترتيب ظهورها لأول مرة. راجع حالة كل ملف، وأي حقول ناقصة أو زائدة أو مختلفة النوع مقارنةً بأول نموذج أمكن قراءته.

يستخدم ملف CSV ترميز UTF-8 مع علامة BOM، ويضيف بادئة إلى القيم التي قد يفسّرها برنامج الجداول على أنها صيغ. إذا استوردت CSV إلى Excel، فاضبط نوع أعمدة المعرّفات على «نص» للحفاظ على الأصفار في بدايتها. يحفظ ملف `.xlsx` الخلايا كنص، ويُبقي المعرّفات مثل `00123` والتشكيل العربي وعلامات الترقيم في النص المختلط كما هي. يضمّ الجدول حالة كل خانة اختيار (`checked` أو `unchecked`) وقيمتها الأصلية من PDF في عمود مستقل. ويعرض قيمة التصدير لحقول الخيارات وتسميتها في عمود مستقل عند اختلافهما.

يحفظ زر «نزّل سجل الحيازة JSON» أسماء الملفات الأصلية وحالات الاستخراج وقيم الحقول كما قُرئت، وبصمات SHA-256 الكاملة لكل ملف PDF مصدر ولكل من ملفَّي CSV وExcel الناتجين. قارن بصمة الملف بالبصمة المسجّلة في نسخة موثوقة من السجل للتحقّق من تطابق محتواه. السجل غير موقّع.

### التحقق من بيان الحيازة

1. افتح `/ar/pdf-mail-merge` واختر «التحقق من بيان الحيازة». اختر ملف JSON الذي حفظته من وضع تعبئة ملفات PDF، أو ملف `batch-custody.json` الموجود داخل أرشيف ملفات PDF المدمجة حسب المجموعة.
2. أضف ملف PDF مستلمًا أو أكثر، أو ألصق النص المقروء من رمز QR الخاص بالسجلّ. يمكنك أيضًا إدخال النوعين معًا. اضغط «تحقّق». تحسب الأداة بصمة SHA-256 من بايتات ملف PDF وتقارنها بالبصمة المسجّلة. تعرض نتيجة تطابق عند تساوي البصمتين، وتنبيهًا عند تطابق اسم الملف واختلاف البصمة. إذا غاب الاسم والبصمة عن البيان، تعرض النتيجة على أنها غير معروفة.
3. يؤكّد تطابق رمز QR أن النص الملصق يشير إلى صف مسجّل في البيان المرفق. للتحقّق من بايتات ملف PDF نفسه، أضف الملف. تعتمد النتيجتان على البيان غير الموقّع الذي تختاره. يتطلّب إثبات هوية جهة الإصدار دليلًا مستقلًا.

يمكن التحقّق من بايتات الملفات باستخدام بيانات الدفعات الأقدم إذا احتوت على بصمات المخرجات. يتطلّب التحقّق من رمز QR تفعيل وضع سجلّ الحيازة الاختياري واستخدام البيان المطابق الذي حُفظ بعد التصدير.

### تجميع الحزم

1. افتح `/ar/pdf-mail-merge` واختر «تجميع الحزم». اختر «جرّب عينة اصطناعية لحزمة الموارد البشرية والموافقة من مستندين» لتحميل بيانات خيالية وفحصها، أو استخدم «أضف ملفات PDF» لاختيار قالبَي AcroForm إلى أربعة قوالب قابلة للتعبئة. استخدم «قدّم القالب» و«أخّر القالب» لترتيب المستندات داخل الحزمة. تُرفض ملفات PDF المشفّرة والموقّعة والمسطّحة ونماذج XFA.
2. استخدم «اختر ملف CSV أو Excel» لتحديد جدول واحد لجميع القوالب. إذا احتوى ملف Excel على أكثر من ورقة ظاهرة، حدّد الورقة المطلوبة من «ورقة العمل». افتح تبويب كل قالب ضمن «ربط الحقول» واربط حقلًا واحدًا قابلًا للتعديل على الأقل بأحد الأعمدة. استخدم «اتركه دون تغيير» لإبقاء مظهر الحقل عند الطباعة.
3. يمكنك تشغيل «أضف غلافًا وفهرسًا باللغتين» لوضع غلاف بالعربية والإنجليزية لكل حزمة. يبيّن الفهرس الصفحة الفعلية التي يبدأ عندها كل مستند. مثلًا، يبدأ المستند الأول في الصفحة 2 بعد الغلاف. إذا كان من صفحتين، يبدأ المستند التالي في الصفحة 4. استخدم «جمّع الحزم حسب عمود في الجدول» لتنظيم الملفات في مجلدات داخل ZIP، و«نمط أسماء ملفات الحزم» لتخصيص أسمائها. إذا وُجد العمود `ID`، يكون نمط التسمية الافتراضي `{{ID}}-packet.pdf`. وإلا يُستخدم رقم الصف الأصلي في اسم الملف.
4. اختر «افحص الحزم». تظهر حالة الصف «جاهز» عندما تجتاز كل قوالبه الفحص. إذا كانت إحدى القيم غير صالحة لحقل اختيار أو لم يتّسع حقل للنص، تظهر حالة «يحتاج إلى مراجعة» ويتوقّف تصدير حزمته كاملةً. راجع القالب والحقل والسبب في «نتائج الفحص»، وصحّح المدخلات، ثم أعد الفحص. يبقى تصدير الحزم الجاهزة للأشخاص الآخرين متاحًا.
5. نزّل «حزم لكل شخص (.zip)» و«بيان سلسلة حيازة الحزم (.json)». يحتوي الأرشيف على ملف PDF مسطّح وجاهز للطباعة لكل شخص جاهز، بالمستندات مرتّبة حسب ترتيب القوالب. يسجّل بيان الحيازة غير الموقّع `packet-custody-manifest.json` بصمات SHA-256 للقوالب الأصلية والجدول المشترك وكل حزمة صُدّرت. للتحقّق من بايتات ملف، قارن بصمته الكاملة بالبصمة المقابلة في نسخة موثوقة من البيان. يتطلّب إثبات هوية الجهة المصدرة دليلًا منفصلًا. [صيغة الحزمة وحقول البيان](docs/subsystems/pdf-engine.md#multi-template-packet-assembly)

### مقارنة القوالب

1. من `/` أو `/ar/pdf-mail-merge`، افتح «مقارنة القوالب». اختر قالبَي AcroForm القابلَين للتعبئة، القديم والجديد. يمكنك إضافة ملف إعدادات الربط القديم بصيغة JSON من الإصدار 1 إلى 13، أو اختيار «جرّب تحديث القالب الاصطناعي (2026 → 2027)» للتجربة بملفات خيالية.
2. راجع الحقول المضافة والمحذوفة، وتغيّرات الأنواع والخيارات وعرض كل عنصر وارتفاعه بالنقاط، وتغيّرات الحدّ الأقصى لعدد المحارف (`/MaxLen`). قد يحدّ صغر مساحة الحقل أو انخفاض حدّ المحارف من القيم التي يمكن تعبئتها. حدّد بديلًا متوافقًا لكل حقل يتطلّب إعادة الربط. قبل الترحيل، عالج الحقول البديلة المفقودة أو المتعارضة والخيارات التي لم تعد متاحة للقواعد الشرطية.
3. نزّل «تقرير الترحيل» بصيغة CSV أو JSON لحفظ التغييرات ونتائج فحص الترحيل وبصمتَي القالبين الأصليين. بعد التحقّق من مراجع الإعدادات، اختر «نزّل الإعداد المسبق المُرحّل» لحفظ نسخة منه. اختر «افتح القالب الجديد والإعداد المُرحّل في وضع تعبئة ملفات PDF» لفحص القالب الجديد مع جدول البيانات الحالي إذا سبق تحميله.

تجري المقارنة والترحيل على جهازك. تحتفظ الإعدادات المُرحّلة برقم إصدارها وبالروابط والتخصيصات والقواعد المدعومة. راجع التنبيهات إلى تغيّرات القالب، ثم افحص الدفعة بالطريقة المعتادة في واجهة التعبئة قبل التصدير. يتحقّق هذا الفحص من قيم الجدول الفعلية، بما فيها الخيارات المتاحة وحدود المحارف واتساع الحقول للنص. [قواعد المقارنة والترحيل](docs/subsystems/pdf-engine.md#template-version-comparison-and-preset-migration) · [مثال من الطرفية](docs/subsystems/cli-automation.md#template-comparison-walkthrough--تجربة-مقارنة-القوالب)

### تعبئة ملفات PDF

اربط الأعمدة بالحقول وعاين النص العربي والنص المختلط، ثم صحّح الصفوف التي تحتاج إلى مراجعة قبل التصدير.

1. اختر نموذج AcroForm فيه حقول مدعومة قابلة للتعديل. افتح «افحص سعة حقول القالب» قبل اختيار جدول البيانات. يفتح زر «جرّب العينة العربية الاصطناعية» نموذج حضور ورشة العمل، وفيه اسم طويل عمدًا لتجربة تعديله. يتيح معرض العينات فتح حضور ورشة العمل أو موافقة العيادة أو خيارات الموارد البشرية متعددة الصفحات أو بطاقة زائر أفقية. تستخدم العينات الأربع بيانات خيالية.
2. انقر على الحقل في معاينة PDF، أو انتقل إليه بمفتاح `Tab` وفعّله بمفتاح `Enter` أو المسافة. ينتقل التركيز إلى إعداد الحقل في لوحة **ربط الحقول**. وعند التركيز على إعداد الربط، يبرز الحقل في المعاينة وتُفتح صفحته عند الحاجة. اختر عمودًا من الجدول أو قيمة محسوبة محليًا للحقول النصية. حدّد «أبقِ المحتوى الأصلي» للحقول التي تريد الإبقاء عليها. تقبل خانات الاختيار `true` أو `false`، و`yes` أو `no`، و`1` أو `0`، و`x` أو خلية فارغة، و«نعم» أو «لا». وتتجاهل المسافات في بداية القيمة ونهايتها وحالة الأحرف الإنجليزية. للقوائم المنسدلة وأزرار الاختيار، انسخ اسم الخيار المعروض في لوحة الربط أو قيمة التصدير المعرّفة له في PDF إذا اختلفت. تبحث الأداة أولًا عن تطابق حرفي مع خيار واحد، ثم تعيد المحاولة بعد تجاهل المسافات في بداية القيمة ونهايتها. احتفظ بالحروف وعلامات التشكيل وحالة الأحرف كما تظهر في الخيار.
3. ابحث في قائمة الفحص المسبق برقم الصف أو اسم الملف أو محتوى الخلية. صفِّ النتائج بحسب الجاهزية أو الحاجة إلى المراجعة أو تنبيهات المصدر. يفتح اختيار صف يحتاج إلى مراجعة أول صفحة فيها مشكلة. اختر ملاءمة الصفحة للمساحة المتاحة أو العرض بنسبة 100٪ أو 125٪ أو 150٪، واضغط على رقم الصفحة للانتقال إليها. تشير النقطة الحمراء إلى صفحة فيها حقل يحتاج إلى مراجعة. إذا لم تطابق القيمة أي خيار أو طابقت أكثر من خيار، تظهر خيارات النموذج لتختار قيمة صالحة من محرّر الصف. إذا تجاوز النص مساحة الحقل أو عدد الأحرف المسموح به، عدّل الخلية أو طبّق الحد الأدنى المقترح لحجم الخط عند ظهوره، ثم راجع المعاينة من جديد.
4. راجع نطاق التصدير في قسم تنزيل الدفعة. النطاق الافتراضي هو «كل الصفوف الجاهزة». اختر صفوفًا جاهزة بعينها، أو اضغط «حدّد الصفوف الجاهزة المطابقة» لتحديد كل الصفوف الجاهزة المطابقة للبحث والتصفية في جميع صفحات القائمة. يقتصر تنزيل ZIP وملف PDF المدمج وتقرير الفحص وبيان سلسلة الحيازة على الصفوف المحددة في هذا النطاق. يؤدي زر «امسح التحديد» إلى إفراغ التحديد وتعطيل التنزيل. للعودة إلى النطاق الافتراضي اضغط «استخدم كل الصفوف الجاهزة». في هذا النطاق، يشمل تقرير الفحص بصيغة CSV أو JSON جميع الصفوف، بما فيها الصفوف التي تحتاج إلى مراجعة.

بعد الفحص المسبق، استخدم «أطول اسم» أو «أصغر حجم خط» أو «أول صف يحتاج مراجعة» أعلى المعاينة للانتقال مباشرةً إلى رقم الصف الأصلي. يفحص خيار «أطول اسم» قيم الحقول النصية وتسميات الخيارات المعروضة في القوائم المنسدلة المرتبطة. اضغط «قارن بين صفّين» واختر «الصف أ» و«الصف ب» لعرض صفحاتهما جنبًا إلى جنب. تظهر المعاينتان إحداهما أسفل الأخرى على الشاشة الضيقة. إذا ظهر نص مرتبط في صف جاهز، تعرض الأداة أصغر حجم خط وأقصر مسافة بين حدود النص المرسوم وحافة حقله، بالنقاط. يعرض الصف الذي يحتاج إلى مراجعة القالب مع تمييز الحقول المتأثرة وذكر أسباب التنبيه.

إذا احتوى ملف Excel على أكثر من ورقة عمل ظاهرة، اختر الورقة من قائمة «ورقة العمل» في قسم ملفات المصدر. تظهر أسماء الأوراق كما هي وبترتيبها في المصنّف، وتُفتح أول ورقة ظاهرة تلقائيًا. تُستبعَد الأوراق المخفية. عند الانتقال إلى ورقة أخرى، تُمسح تعديلات الصفوف وعمليات التنظيف المطبّقة وتحديد الصفوف، ثم تُفحَص الورقة الجديدة. يبقى قالب PDF وإعدادات الإخراج. راجع ربط الحقول بعد التبديل.

يحتوي أرشيف ZIP افتراضيًا على ملفات PDF منفصلة قابلة للتعديل. من **إعدادات الإخراج**، فعّل «تسطيح ملفات PDF الفردية داخل ZIP» لتثبيت مظهر الحقول في نسخة منفصلة لكل صف. يجمع ملف PDF المدمج للطباعة النسخ المسطّحة وفق تخطيط الطباعة المحدّد. تحتفظ النسخ القابلة للتعديل بقيم الحقول غير المرتبطة ومظهرها الأصلي. عند التسطيح يصبح المظهر المرئي للحقول جزءًا من الصفحة وتزول عناصر النموذج التفاعلية.

يحسب «تقدير أوراق الطباعة» في قسم تنزيل الدفعة ورقةً واحدة لكل صفحة PDF عند الطباعة على وجه واحد. يشمل العدد الصفوف الجاهزة في النطاق الحالي وجميع صفحات الغلاف عند تفعيله، بما فيها صفحات الفهرس الإضافية. يعرض التقدير عدد الأوراق عند وضع سجل واحد أو سجلّين أو أربعة سجلات في الورقة للقوالب المؤهّلة من صفحة واحدة، ويحسب التوفير مقارنةً بتخطيط السجل الواحد. عند اختيار عمود للتجميع، راجع إجمالي الملف المدمج وإجمالي ملفات المجموعات على حدة. تُحسب أوراق السجلات لكل مجموعة على حدة، وتُحسب الورقة الأخيرة ولو بقيت فيها مواضع فارغة، ثم تُضاف صفحات غلاف المجموعة. إذا خلا النطاق من الصفوف الجاهزة، يكون عدد الأوراق صفرًا.

**تجميع الملفات حسب عمود**

1. في **إعدادات الإخراج**، اختر عمودًا مثل «الفرع» من «تجميع الملفات حسب العمود». الخيار الافتراضي هو «بلا تجميع (مجلد واحد)». إذا غاب العمود المحفوظ عن ورقة العمل الحالية، اختر عمودًا متاحًا أو ارجع إلى الخيار الافتراضي.
2. راجع المجلدات وأعداد الصفوف الجاهزة في قسم تنزيل الدفعة. تنتقل القيم الفارغة أو المكوّنة من مسافات فقط إلى مجلد `_Ungrouped`. تحتفظ أسماء المجلدات بالحروف العربية واللاتينية، وتُهيّأ لتناسب فكّ أرشيف ZIP. إذا نتج الاسم نفسه من قيم مختلفة، يُضاف رقم إلى أسماء المجلدات اللاحقة. يستخدم أرشيف الملفات الفردية مسارات مثل `Riyadh/00123.pdf` ويعالج تكرار أسماء الملفات داخل كل مجلد. يعرض حقل `zipPath` المسار المقرّر في تقرير الفحص بصيغتَي CSV وJSON، والمسار الفعلي بعد التصدير في بيان سلسلة الحيازة المستقل.
3. اختر «تنزيل ملفات PDF المدمجة لكل مجموعة (.zip)» للحصول على ملف صالح للطباعة لكل مجموعة فيها صفوف جاهزة ضمن النطاق الحالي، مثل `Riyadh-merged.pdf`. يمكنك استخدام لغة الغلاف المحدّدة، بما فيها العربية والإنجليزية معًا. تخصّ أعداد الغلاف ونطاقات الصفحات كل مجموعة على حدة. تسري العلامة المائية ورمز QR المحلي وتخطيطات السجلّين أو السجلات الأربعة على صفحات السجلات المؤهّلة عند تفعيلها. يحتوي جذر الأرشيف على `batch-custody.json` وفيه بصمات المصادر ونطاق التصدير والمجموعات وأرقام الصفوف الأصلية ومسار كل ملف مدمج وحجمه بالبايت وبصمته SHA-256. يظلّ تنزيل ملف PDF مدمج واحد متاحًا.

استخدم «نزّل بيان سلسلة الحيازة (.json)» في قسم تنزيل الدفعة لحفظ بصمات SHA-256 الكاملة لقالب PDF الأصلي وملف CSV أو Excel الأصلي. في حالة Excel، تشمل البصمة المصنّف كاملًا. بعد تبديل ورقة العمل، يضيف البيان الحقل `sheetName` وفيه اسم الورقة كما هو، حتى إذا عدت إلى أول ورقة ظاهرة. ما دمت تستخدم الورقة التي فُتحت تلقائيًا، تكفي بصمة المصنّف وترتيب أوراقه لتحديد أول ورقة ظاهرة. يحتفظ بيان CSV بحقول الإصدار الحالي. يسجّل البيان نطاق التصدير وأرقام الصفوف الجاهزة فيه حسب ترتيبها في القائمة الأصلية، بدءًا من الرقم 1. بعد تصدير ZIP بنجاح، يسجّل البيان اسم كل ملف PDF داخله وحجمه بالبايت وبصمته. وبعد تصدير ملف PDF مدمج بنجاح، يسجّل بصمته أيضًا. نزّل البيان بعد اكتمال عمليات التصدير التي تريد التحقّق منها وقبل تغيير ورقة العمل أو التحديد أو إعدادات الإخراج. افتح أيّ بصمة مصدرية لعرضها كاملة أو نسخها. افتح وضع «التحقق من بيان الحيازة» لمقارنة ملف PDF مستلم أو رمز QR الخاص بالسجلّ بالبيان غير الموقّع.

يعرض فحص سعة الحقول كل حقل ومواضع ظهوره في النموذج، مع رقم الصفحة وزاوية الدوران والعرض والارتفاع المتاحين بالنقاط والحدّ `/MaxLen` عند وجوده. يمكنك تنزيل التقرير بصيغة CSV ومشاركته مع من يعدّ جدول البيانات. تحسب الأداة السعة التقريبية من عينات نصية بالحد الأدنى الحالي لحجم الخط، بخط نوتو نسخ عربي مع التشكيل وخط نوتو سانس للنص اللاتيني. يشمل العدّ علامات التشكيل والمسافات. يختلف النص الذي يتّسع له الحقل بحسب الحروف وطريقة اتصالها. يتحقّق الفحص المسبق من القيم الفعلية في كل موضع للحقل.

يسرد «تنبيه هامش الطباعة» مواضع الحقول المرتبطة التي تقلّ فيها المسافة إلى أقرب حافة للصفحة عن 9 نقاط (نحو 3.2 مم). يعرض اسم الحقل ورقم الصفحة والحافة والمسافة بالنقاط بعد دوران الصفحة. تعني المسافة السالبة أن موضع الحقل يتجاوز الحافة. فعّل «دليل هامش 9 نقاط» بجوار أدوات تكبير المعاينة لإظهار الهامش على الصفحة الحالية. يظلّ تصدير الصفوف الجاهزة متاحًا. اختبر نسخة على الطابعة التي ستستخدمها.

تعرض قائمة الفحص أسماء الملفات النهائية المستخدمة في أرشيف ZIP وتقرير الفحص. يحتفظ كل صف بالاسم الذي خُصّص له عند تصدير مجموعة محددة. افتح «تم تعديل اسم الملف» لمعرفة السبب، سواء نُقّح الاسم أو تغيّر لأنه محجوز في Windows أو أُضيف إليه رقم لتفادي التكرار. يؤدي تغيير نمط تسمية الملفات إلى تحديث القائمة فورًا.

للحقول النصية، اختر من مجموعة **أعمدة افتراضية (تُحسب محليًا)** لإدراج رقم الصف في الجدول الأصلي (`1`، `2`، …)، أو رقم تسلسلي من أربع خانات على الأقل (`0001`، `0002`، …)، أو التاريخ الميلادي المحلي بأرقام غربية (`2026-11-27`) أو عربية هندية (`٢٠٢٦-١١-٢٧`). يُحدَّد التاريخ عند تحميل الجدول. يحتفظ كل صف برقمه الأصلي عند تصفية القائمة أو استبعاد صفوف تحتاج إلى مراجعة أو تصدير صفوف محددة. يمكنك إضافة نص قبل رمز القيمة أو بعده بصيغة مثل `CERT-{{PADDED_ROW_001}}`. يتحقّق الفحص المسبق من طول النص النهائي ومدى ملاءمته لمساحة الحقل.

في نمط أسماء ملفات PDF، استخدم `[[@ROW_INDEX]]` أو `[[@PADDED_ROW_001]]` أو `[[@TODAY_ISO]]` أو `[[@TODAY_AR]]` لإدراج هذه القيم. يجمع النمط `CERT-[[@PADDED_ROW_001]]-{{Name}}.pdf` رقمًا تسلسليًا مع القيمة من عمود `Name`. وفي اسم الملف، يبقى `{{PADDED_ROW_001}}` إشارةً إلى عمود في الجدول يحمل هذا الاسم حرفيًا.

افتح اختصارات لوحة المفاتيح من الزر المخصّص لها أو اضغط `؟` أو `?` خارج حقول الإدخال. واضغط `/` خارج حقول الإدخال للانتقال إلى البحث عند ظهور القائمة. استخدم `↑` و`↓` للتنقّل بين الصفوف المطابقة عندما يكون التركيز داخل جدول الصفوف. يغلق `Esc` نافذة الاختصارات ويعيد التركيز إلى موضعه السابق. داخل محرّر الصف، يستعيد `Esc` القيم التي كانت موجودة قبل فتحه ويعيد التركيز إلى زر «عدّل الصف». يمكنك تعطيل اختصارات المفتاح الواحد من النافذة في الصفحة الحالية.

لتعديل نصوص الجدول دفعة واحدة، افتح لوحة «نظّف واستبدل نصوص الجدول» وحدّد عمودًا أو أكثر. تعرض المعاينة العدد الدقيق للصفوف والخلايا التي ستتغيّر، وما يصل إلى خمسة أمثلة قبل التعديل وبعده. يكون خيار تنظيف المسافات محدّدًا في اللوحة، ويبدأ أثره عند التطبيق. يزيل هذا الخيار المسافات في أول النص وآخره، ويدمج المسافات المتتالية، ويحوّل المسافات غير القابلة للكسر إلى مسافات عادية. ويحذف المحرفين U+200B وU+FEFF مع الإبقاء على محرفَي الوصل والفصل ZWJ وZWNJ. ويمكنك تفعيل كل تغيير على حدة لتحويل `أ/إ/آ` إلى `ا`، أو `ة` إلى `ه`، أو `ى` إلى `ي`، أو لحذف علامات التشكيل في النطاق U+064B–U+065F والمحرف U+0670. يبحث خيار البحث والاستبدال عن النص حرفيًا بعد تطبيق خيارات التنظيف المحدّدة، ويراعي حالة الأحرف افتراضيًا. اترك نص الاستبدال فارغًا لحذف المطابقات. يعيد زر «تراجع عن آخر تعديل جماعي» القيم التي كانت موجودة قبل تطبيقه، بما فيها التعديلات السابقة والأصفار في أول المعرّفات مثل `00123`. استخدمه قبل إجراء تعديل يدوي جديد على خلية.

في الحقول النصية المرتبطة، اضبط المحاذاة تلقائيًا أو إلى اليمين أو اليسار أو الوسط. يبقي الخيار التلقائي موضع النص الافتراضي. تضع المحاذاة إلى اليمين أو اليسار النص عند الطرف المحدّد، ويعتمد التوسيط على العرض الفعلي للحروف وعلاماتها. تُشكَّل الحروف العربية ويُرتّب النص المختلط في جميع الخيارات.

افتح «تنسيق النص» في حقل نصي مرتبط. من «الأرقام»، اختر الإبقاء على الأرقام الواردة، أو `٠١٢٣` للأرقام العربية المشرقية، أو `0123` للأرقام الغربية. مثلًا، اربط قيمة `00123` بحقلَي الملاحظات والمعرّف، ثم اختر `٠١٢٣` للملاحظات و`0123` للمعرّف. تظهر القيمتان `٠٠١٢٣` و`00123` في المعاينة. تُحوَّل الأرقام في الحقل المحدّد قبل فحص ملاءمة النص وحفظ قيمة الحقل، مع بقاء الأصفار البادئة. اضبط «ارتفاع السطر» للنص متعدّد الأسطر على 1× أو 1.15× أو 1.3×، و«الحاشية الداخلية» على 2 أو 4 أو 6 نقاط أو على «الإعداد الافتراضي». تُستخدم الإعدادات نفسها للفحص المسبق ورسم ملف PDF.

تتيح عينة بطاقة الزائر الأفقية تجربة اقتراح حجم الخط للدفعة. إذا أمكن لبعض الصفوف اجتياز الفحص بخفض الحد الأدنى لحجم الخط، يعرض الزر عددها. عند تطبيق الاقتراح يُعاد فحص الدفعة كاملة. راجع التنبيهات المتبقية قبل التصدير.

للقوالب المؤهّلة من صفحة واحدة، اختر «سجلان لكل ورقة مع علامات القص» أو «شبكة A4 لأربعة سجلات (توفير يصل إلى 75٪)» من «تخطيط الأوراق في ملف PDF المدمج» ضمن **إعدادات الإخراج**. يسري الخيار على الملف المدمج وعلى كل ملف في أرشيف المجموعات. تختار الأداة اتجاه ورقة A4 الذي يستوعب السجلات بأكبر مقاس ممكن وبمقياس موحّد مع ترك الهوامش والفواصل. يضع تخطيط السجلات الأربعة السجلات في صفَّين وعمودَين. تظهر علامات قص الزوايا خارج حدود السجلات. يمكنك تفعيل «خطوط القص في المنتصف» لإضافة خطوط في الفواصل. يتغيّر مقاس العلامة المائية ورمز QR وختم الاعتماد مع السجل عند تفعيلها. تحقّق من مقاس البطاقة بعد القص ووضوح النص على ورقة تجريبية.

يملأ تخطيط السجلات الأربعة مواضع كل ورقة بترتيب الجدول افتراضيًا. اختر «ترتيب القص والتكديس» للاحتفاظ بترتيب الجدول بعد قص رزمة الأوراق. رتّب الأوراق حسب صفحات PDF، ثم قصّها دفعة واحدة واجمع الرزم بهذا الترتيب، أعلى اليسار ثم أعلى اليمين ثم أسفل اليسار ثم أسفل اليمين. تجاوز المواضع الفارغة. في دفعة من سبعة سجلات، تحمل الورقة الأولى السجلات 1 و3 و5 و7، وتحمل الثانية السجلات 2 و4 و6 وتترك الموضع الأخير فارغًا. تحقّق من ترتيب الأوراق قبل القص. عند امتلاء المواضع الأربعة في كل ورقة وإيقاف الغلاف، يوفّر التخطيط 75٪ من الورق مقارنةً بوضع سجل واحد من صفحة واحدة لكل ورقة. يمكن أن تقلّ النسبة بسبب المواضع الفارغة أو الأغلفة أو فصل المجموعات.

الخيار الافتراضي هو «سجل واحد لكل ورقة (قياسي)». تستخدم واجهة المتصفح التخطيط القياسي للقوالب متعددة الصفحات. يتوقّف تصدير سجلَّين أو أربعة سجلات لكل ورقة إذا كان سيُسقط تعليقًا ظاهرًا معدًّا للطباعة. استخدم التخطيط القياسي لهذا الملف.

لإضافة فهرس للطباعة، فعّل «أدرج صفحة غلاف قابلة للطباعة في ملف PDF المدمج» من **إعدادات الإخراج**. يكون الغلاف متوقّفًا افتراضيًا. من «لغة صفحة الغلاف» اختر لغة الواجهة (الخيار الافتراضي)، أو الإنجليزية، أو العربية، أو اللغتين معًا. يعرض الغلاف الثنائي العناوين وإحصاءات الدفعة بالإنجليزية والعربية جنبًا إلى جنب في الصفحة الأولى، ويستخدم فهرسًا واحدًا. يعرض الغلاف تاريخ التصدير المحلي واسم ملف القالب والحد الأدنى لحجم الخط ووضع الخط المستخدَمَين في الفحص. يشير «جاهز» إلى الصفوف المدرجة في الملف، و«يحتاج إلى مراجعة» إلى الصفوف التي رصد فيها الفحص مشكلة في الجدول كاملًا، و«تم تخطيه» إلى جميع الصفوف المستبعدة. يبيّن الفهرس الرقم الأصلي لكل صف مدرج واسم ملفه النهائي ونطاق صفحاته الفعلي. يشمل الترقيم صفحات الغلاف الإضافية إذا امتدّ الفهرس إلى أكثر من صفحة.

عند طباعة سجلَّين أو أربعة سجلات لكل ورقة، يعرض الفهرس رقم الورقة التي يظهر عليها كل سجل، بما في ذلك ترتيب القص والتكديس. مثلًا، عند وضع سجلَّين لكل ورقة في دفعة تضم ثلاثة سجلات تسبقها صفحة غلاف واحدة، يشير السجلان الأول والثاني إلى الورقة 2، ويشير الثالث إلى الورقة 3.

لطباعة بصمات الملفات المصدرية مختصرةً أسفل الغلاف، فعّل «أدرج بصمات الملفات المصدرية على صفحة الغلاف» بعد تفعيل الغلاف. تظهر أول 12 خانة سداسية عشرية من كل بصمة. يكون الخيار متوقّفًا افتراضيًا ويسري في علامة التبويب الحالية. استخدم البصمات الكاملة في بيان JSON للتحقّق من محتوى الملفات.

من **إعدادات الإخراج**، يمكنك إضافة علامة مائية للطباعة. اختر `DRAFT` أو `CONFIDENTIAL` أو «مسودة» أو «سري»، أو أدخل نصًا مخصّصًا من 32 محرفًا كحدّ أقصى. تكون العلامة متوقّفة افتراضيًا. اختر زاوية −45° أو 0° أو 45°، واضبط عتامة العلامة بين 10٪ و25٪. تبدأ العلامة عند تفعيلها بزاوية 45° وعتامة 14٪. تتحقّق الأداة من توفر محارف العلامة في الخطوط المضمّنة قبل التصدير. تظهر العلامة على صفحات النماذج في ملف PDF المدمج للطباعة وفي ملفات PDF المسطّحة داخل ZIP.

افتح «رمز QR للطباعة (اختياري)» من **إعدادات الإخراج**، واختر إحدى زوايا الصفحة، وأدخل نمطًا مثل `CERT-{{ID}}` أو `CERT-[[@PADDED_ROW_001]]`. تتغيّر المعاينة مباشرة عند اختيار صف آخر أو تعديل قيم الصف الحالي. المقاس الافتراضي 48 نقطة. يشمل المربّع الأبيض، الذي يتراوح طول ضلعه بين 36 و72 نقطة، هامشًا أبيض بعرض أربع وحدات حول الرمز، ويبعد 9 نقاط عن حافتَي الزاوية المختارة. يظهر الرمز على كل صفحة من صفحات السجلات في ملف PDF المدمج للطباعة وفي ملفات PDF المسطّحة داخل ZIP. يمكنك إيقاف الرمز من قائمة المواضع.

الحد الأقصى للنص بعد تطبيق النمط هو 106 بايت لنص ASCII، أو 105 بايت بترميز UTF-8 إذا احتوى النص على محارف خارج ASCII. يتوقّف التصدير المطلوب عند وجود مرجع مفقود أو غير صالح، أو نص فارغ، أو محارف Unicode غير صالحة، أو تداخل مع حقل مرئي. يحمل الرمز نفسه النص الناتج من النمط.

لإنشاء رمز QR يمكن التحقّق منه باستخدام بيان الدفعة، اختر زاوية وفعّل خيار استخدام رمز QR لسجلّ الحيازة. يحمل الرمز بداية بصمة المصادر ورقم الصف في الجدول الأصلي، وتظلّ قيم الخلايا خارج الرمز. احفظ بيان الحيازة مع الملفات بعد التصدير. الخيار متوقّف افتراضيًا، وتظلّ الأنماط المخصّصة والإعدادات المحفوظة سابقًا قابلة للاستخدام.

افتح «ختم الاعتماد الرسمي (اختياري)» من **إعدادات الإخراج** وفعّل «إضافة ختم الاعتماد الرسمي». اكتب الاسم بالإنجليزية وبالعربية، وأدخل تاريخ الإصدار الميلادي بصيغة `YYYY-MM-DD`، ثم اختر زاوية. الحد الأقصى لكل اسم 32 محرف Unicode. تُظهر معاينة PDF للصف الجاهز المحدّد الختم بإطاره المزدوج على صفحات السجل. يتوقّف تصدير الطباعة إذا ضاقت المساحة أو تداخل الختم مع حقل مرئي أو رمز QR. اختر زاوية أخرى أو أوقف الختم.

يظهر الختم على صفحات السجلات في ملفات ZIP المسطّحة وملفات PDF المدمجة للطباعة، بما فيها الملفات المنفصلة حسب المجموعة وتخطيطات السجلَّين أو السجلات الأربعة لكل ورقة. يحتفظ أرشيف ZIP القابل للتعديل بالحقول التفاعلية. الختم عنصر مرسوم على الصفحة. يتطلّب التوقيع الرقمي أو إثبات هوية جهة الإصدار دليلًا مستقلًا.

قفل الحقول للطباعة يعني إزالة عناصر النموذج التفاعلية. تبقى الملفات بصيغة PDF عادية ويمكن تعديلها بأدوات تحرير PDF. إذا تعذّر التسطيح لأن أحد الحقول المرئية يفتقر إلى مظهر محفوظ صالح، نزّل ملفات ZIP القابلة للتعديل أو استخدم قالبًا يحتوي على مظاهر محفوظة لحقوله. افتح نسخة تجريبية في برنامج العرض أو المشاركة الذي ستستخدمه، وتحقّق من النص العربي والخيارات وترتيب الصفحات قبل إرسال الدفعة أو طباعتها. تغطّي اختبارات PDF.js وPyMuPDF ملفات ومسارات عرض محددة. اختبر النتيجة بنفسك إذا كنت ستستخدم iOS أو تطبيق «المعاينة» في macOS أو واتساب أو طابعة.

احفظ المعرّفات مثل `00123` كنص. راجع تنبيهات المصدر إذا حوّل Excel أحد المعرّفات إلى رقم قد تكون أصفاره الأولى أو بعض خاناته ضاعت. عندما ترتبط خلية تحتوي على صيغة بأحد الحقول، تستخدم الأداة آخر نتيجة حفظها Excel في الملف، أو تترك القيمة فارغة إذا لم تُحفَظ فيه نتيجة. راجع التنبيه وأعد حساب الجدول أو استبدل الصيغة بقيمة تحققت منها قبل الطباعة.

من **إعدادات الإخراج**، يمكنك استخدام خطوط نوتو المضمّنة أو اختيار ملف خط محلي بصيغة `.ttf` أو `.otf`. يعرض الفحص تنبيهًا إذا احتاج الحقل إلى حروف أو علامات يفتقر إليها الخط. عاين ملف PDF مع كل قالب وخط جديد. عند مسح اختيار الخط المخصّص، تعود الأداة إلى إعداد الخط المضمّن. تبقى بيانات الخط في علامة التبويب الحالية أثناء المعالجة، وقد يُضمَّن الخط في ملفات PDF التي تنشئها.

احفظ ربط الحقول ونمط تسمية الملفات والحد الأدنى لحجم الخط وإعداد الخط المضمّن وخيارات الإخراج في ملف JSON محلي. تُحفَظ قواعد التحقّق من بيانات الجدول في الإصدار 13. تظلّ الإصدارات من 1 إلى 12 قابلة للاستيراد بإعداداتها المعتادة. عند غياب قواعد التحقّق، تُحفَظ إعدادات السجلات الأربعة في الإصدار 12، أو القواعد الشرطية في الإصدار 11 عند غياب إعدادات السجلات الأربعة. وتستخدم الإعدادات الأبسط الإصدارات السابقة. يُحسب التاريخ عند تحميل الجدول. بعد الاستيراد، أعد اختيار ملف الخط المخصّص عند الحاجة. [إصدارات الإعدادات وقيمها الافتراضية](docs/subsystems/web-preview-seo.md#workbench-ux-standards)

استخدم زر حفظ المسودة بصيغة `.json` للاحتفاظ بتعديلات الخلايا وتغييرات التنظيف وملخّصها وإعدادات الربط والإخراج، بما فيها قواعد التحقّق وقواعد التعبئة الشرطية وربط الأعمدة المحسوبة وتنسيق النص والعلامة المائية ورمز QR وختم الاعتماد ولغة الغلاف وتخطيط أوراق ملف PDF المدمج وعمود التجميع. لاستعادة المسودة، اختر ملف PDF وجدول البيانات نفسيهما، وورقة العمل نفسها إذا كان الجدول بصيغة Excel، وملف الخط المخصّص نفسه إذا سبق أن استخدمته. ثم اضغط زر تحميل المسودة. تتحقّق الأداة من تطابق محتوى الملفات الأصلية واسم ورقة العمل حرفيًا، وتعرض تنبيهًا عند الاختلاف قبل تطبيق أي تغييرات. قد تحتوي المسودة على قيم من خلايا الجدول. تُحفظ في ملف JSON الذي تنزّله، دون نسخ إلى السحابة أو إلى مساحة تخزين المتصفح.

في الواجهتين العربية والإنجليزية، يظهر الامتداد `.pdf` عند الطرف الأيمن من أسماء الملفات المختلطة مثل `00001-ليلى حسن.pdf`. وفي بطاقة ملفات المصدر بالعربية تظهر نقطة امتداد `.xlsx` على يسار الأحرف في تلميح اختيار الجدول. يتطلّب وضع التعبئة حقولًا تفاعلية مدعومة، ويرفض نماذج XFA والملفات الموقّعة أو المشفّرة. تبقى ملفاتك على جهازك أثناء المعالجة والمعاينة والتصدير. يعالج عامل محلي في المتصفح (Web Worker) دفعات من 500 صف على مجموعات تضمّ كلّ منها 25 صفًا، ويعرض تقدّم المعالجة. يوقف زرّ الإلغاء المهمة الجارية ويحرّر بيانات المعالجة المؤقتة. يحتاج المتصفح إلى ذاكرة كافية لتجميع ملف ZIP أو PDF النهائي، وتختلف الذاكرة المطلوبة بحسب القالب وحجم الملف الناتج.

في دليلَي تعبئة PDF على `/ar/pdf-mail-merge` و`/arabic-pdf-form-filler` يمكنك التبديل بين عرض تُقصّ فيه أجزاء من الحروف وعرض يضبط موضعها بحسب حدود الحروف وعلامات التشكيل في المثال الاصطناعي `بَنِي يَمَن / سَلْمَى بِنْت يَاسِين`. تحقّق من نصّك في معاينة PDF.

راجع [واجهة العمل بالعربية مع عينة اصطناعية](docs/reports/screenshots/m3/desktop-m3-ar-rtl-filenames.png) و[سيناريو العرض بالعربية والإنجليزية](docs/launch/demo-walkthrough.md).

#### مسودات البريد دون اتصال

1. في واجهة تعبئة PDF، حمّل الجدول وأكمل الفحص المسبق. حدّد ما إذا كنت تريد كل الصفوف الجاهزة أو الصفوف المحدّدة فقط. من «إعدادات الإخراج»، افتح «مسودات البريد الإلكتروني (.eml)» واختر «عمود بريد المستلم» من الورقة الحالية.
2. اكتب «الموضوع» و«الرسالة». يمكنك مثلًا كتابة `Certificate / شهادة — {{Name}}`. يُستبدل `{{Name}}` بقيمة الخلية تحت عنوان العمود المطابق حرفيًا وفي خطوة واحدة. تبقى قيمة الخلية نصًا حرفيًا حتى لو احتوت على رمز آخر. يمكن أن تتألّف الرسالة من عدة أسطر. يحتاج كل صف جاهز في النطاق إلى عنوان بريد واحد بأحرف ASCII، مثل `layla@example.test`. يتوقّف إنشاء الحزمة إذا كان العنوان مفقودًا أو غير صالح أو تضمّن اسم عرض أو قائمة عناوين. وينطبق ذلك أيضًا على رموز الأعمدة غير الصالحة أو المجهولة وعلى فواصل الأسطر في عنوان المستلم أو الموضوع أو اسم المرفق. صحّح الصف أو الإعداد ثم أعد المحاولة.
3. اختر «مسودات البريد للعمل دون اتصال (.zip)». يحتوي الأرشيف على ملف `.eml` لكل صف جاهز في النطاق، بعنوان مستلم واحد وملف PDF مطابق لنسخة الصف في أرشيف الملفات الفردية الحالي، سواء كانت قابلة للتعبئة أو مسطّحة. يتضمّن الأرشيف سجل التوزيع بصيغتَي CSV وJSON وبيان حيازة لملفات PDF المرفقة. نزّل نسخة مستقلة عبر «سجل التوزيع (.csv)». يسجّل الملف رقم الصف الأصلي وعنوان المستلم واسم المرفق وبصمتَي SHA-256 للمرفق والمسودة.
4. فك ضغط الأرشيف على جهاز موثوق. طابق المستلم والمرفق مع سجل التوزيع، ثم افتح المسودة أو استوردها في برنامج البريد. تختلف طريقة التعامل مع `.eml` حسب البرنامج. تحقّق من إمكانية تحرير المسودة ومن المرفق قبل الإرسال. تُنشئ ArabiForm الملفات محليًا دون SMTP أو تفويض لخدمة البريد أو إرسال تلقائي.

تعامل مع الأرشيف والسجل بصيغتَيه كملفات حسّاسة. فهي تضمّ عناوين المستلمين، وتضمّ المسودات أيضًا نص الرسالة وملفات PDF المرفقة. [مثال من الطرفية مع نسخة اختيارية](docs/subsystems/cli-automation.md#email-drafts-and-review-masks--مسودات-البريد-وحجب-القيم)

#### نسخ المراجعة المحجوبة

من «إعدادات الإخراج»، افتح «نسخ المراجعة المحجوبة». تحت «حجب القيمة للمراجعة»، اختر «أبقِ آخر 4 محارف» أو «احجب القيمة كاملة» لكل حقل نصي مرتبط تريد حمايته. افحص معاينة PDF ثم صدّر النسخ. يحوّل الخيار الأول `0012345678` إلى `******5678` ويحجب القيم المكوّنة من أربعة محارف مرئية فأقل بالكامل. يُعدّ الحرف العربي مع علامات تشكيله محرفًا واحدًا هنا. يستبدل الحجب الكامل كل محرف مرئي بنجمة ASCII واحدة `*`، وتبقى القيم الفارغة فارغة. يحدث الحجب قبل تنسيق الأرقام ورسم الحروف وفحص ملاءمتها للحقل. اختر «بلا حجب» عند إعداد النسخ الأصلية. تُطبّق خيارات الحجب في الجلسة الحالية فقط ولا تُحفظ مع إعدادات الربط أو مسودات الدفعة.

يسجّل بيان الحيازة `redactedReview: true` وأسماء الحقول التي حُجبت بالفعل ضمن التصدير. يقتصر الحجب على حقول PDF المحدّدة. قد تبقى القيم الأصلية في ملفات المصدر ومحرّر الصفوف ومحتوى القالب أو الحقول الأخرى. إذا استخدم نمط التسمية عمودًا محميًا، تعيّن ArabiForm أسماء مثل `row-0002.pdf`. اختر أعمدة أخرى إذا استُخدم عمود محمي للتجميع أو نص QR المخصّص أو عناوين البريد أو رموز الأعمدة داخل الرسالة. راجع محتوى القالب والحقول الأخرى والأسماء والأختام والرسائل وأي ملفات مرافقة قبل المشاركة. [تفاصيل الحجب](docs/subsystems/pdf-engine.md#redacted-review-copies)

#### شهادة ما قبل الطباعة

بعد الفحص المسبق، اختر «نزّل شهادة ما قبل الطباعة (.pdf)» لحفظ `print-shop-certificate.pdf` في صفحة واحدة بالعربية والإنجليزية. تخصّ هذه الوثيقة ملف الطباعة المدمج `arabiform-merged.pdf`. يمكنك تنزيل أحد الملفَّين أولًا، ويظلّ محتوى ملف الطباعة مطابقًا لبصمته ما دام التحديد وإعدادات الإخراج كما هما. تعرض الوثيقة أسماء قالب PDF وجدول البيانات وملف الطباعة المدمج وبصمات SHA-256 الكاملة لها، وعدد الصفوف المدرجة والمستبعدة، والتخطيط وعدد الأوراق وصفحات الغلاف، والخطوط المضمّنة، وأصغر حجم للنص المرتبط بعد تغيير المقياس عند توفّر القياس.

إذا تعذّر رسم اسم ملف بالخطوط المضمّنة، تظهر عبارة بديلة مكانه على الصفحة. تجد الأسماء الأصلية وقائمة الخطوط المضمّنة بصيغة JSON في حقل «الموضوع» ضمن خصائص الشهادة. استخدم بصمة SHA-256 الكاملة المطبوعة على الصفحة للتحقّق من محتوى الملف.

تشير عبارة «0 clipped fields verified» إلى اجتياز النص المرتبط في الصفوف الجاهزة المدرجة فحص اتساع الحقول للحروف المرسومة. قد تكون هناك صفوف أخرى مستبعدة. تستطيع المطبعة مطابقة بصمة SHA-256 للملف المدمج المستلَم مع البصمة في هذه الوثيقة غير الموقّعة. يُفحَص تصميم القالب الأصلي والقص والناتج الفعلي للطابعة وهوية جهة الإصدار بوسائل مستقلة. تُنشأ الوثيقة محليًا عند نجاح تجهيز الملف المدمج ووجود صف جاهز واحد على الأقل. لها ملف مستقل عن ملفات المجموعات وبيان الحيازة.

#### التحقق من بيانات الجدول

من «ربط الحقول»، افتح «التحقق من بيانات الجدول» واختر «أضف قاعدة تحقق». حدّد عمود الجدول وقاعدة التحقّق ثم اضغط «طبّق القاعدة». يمكنك التحقّق من أعمدة غير مرتبطة بحقول PDF. تُفحَص قيمة الخلية بعد التعديل أو التنظيف وقبل تنسيقها لملف PDF. إذا تغيّر عنوان عمود تستخدمه قاعدة محفوظة أو غاب عن ورقة العمل، تظلّ صفوفه بحاجة إلى مراجعة إلى أن تستعيد العنوان الأصلي أو تعدّل القاعدة.

| القاعدة | القيم المقبولة |
| --- | --- |
| مطلوب | قيمة فيها محرف واحد على الأقل غير المسافات البيضاء. |
| الآيبان (`Mod-97`) | حروف لاتينية كبيرة وأرقام `0–9` وفق الطول والصيغة المحدّدَين للبلد المدعوم، مع اجتياز فحص `ISO 13616`. يتجاهل الفحص المسافات العادية مع إبقائها في القيمة. يبقى الصف بحاجة إلى مراجعة إذا أمكن تبديل محرفين مختلفين متجاورين والحصول على قيمة أخرى تجتاز الفحص. |
| تاريخ `ISO` | تاريخ ميلادي موجود فعلًا مكتوب بالأرقام `0–9` بصيغة `YYYY-MM-DD`. يُقبل `2024-02-29` ويُرفض `2026-02-29` و`2026-04-31`. |
| عدد أرقام محدّد | من 1 إلى 32 رقمًا من `0–9` حسب العدد المختار، دون مسافات أو فواصل. يتكوّن `0012345678` من عشرة أرقام. احفظ المعرّفات كنص للإبقاء على الأصفار البادئة. |
| البريد الإلكتروني | عنوان واحد مكتوب بمحارف `ASCII` دون أسطر جديدة أو اسم عرض أو قائمة مستلمين. |
| قائمة القيم المسموح بها | تطابق حرفي مع إحدى القيم، مع مراعاة حالة الحروف. أدخل قيمة واحدة في كل سطر. فعّل «تجاهل المسافات في بداية القيمة ونهايتها» عند الحاجة. |

اختر «جرّب مثال رواتب الخليج الاصطناعي للتحقق من IBAN» لاستبدال الملفات والإعدادات الحالية بمثال فيه ثلاثة صفوف خيالية، أحدها جاهز والآخران بحاجة إلى مراجعة. من قائمة المراجعة، غيّر `IBAN` في الصف الثاني من `SA31 0000 0000 0000 0001 0002` إلى `SA31 0000 0000 0000 0001 0001`، وغيّر `Effective Date` في الصف الثالث من `2026-02-29` إلى `2026-02-28`. اضغط «تمّ التعديل» وتأكّد من انتقال الصف إلى حالة الجاهزية. تبقى الصفوف التي تحتاج إلى مراجعة خارج ملفات PDF المصدّرة. تعرض تقارير الفحص بصيغتَي CSV وJSON رقم الصف الأصلي وعنوان العمود والقاعدة وسبب الإخفاق. [تفاصيل القواعد والتقارير](docs/subsystems/roster-mapper.md#roster-schema-validation) · [تجربة التحقق من الطرفية](docs/subsystems/cli-automation.md#roster-validation-walkthrough--تجربة-التحقق-من-بيانات-الجدول)

#### قواعد التعبئة الشرطية

من «ربط الحقول»، افتح «قواعد التعبئة الشرطية» واختر «أضف قاعدة». حدّد حقل PDF مرتبطًا وعمودًا من الجدول وشرطًا. يمكنك كتابة نص أو مسحه، أو تحديد خانة اختيار أو إلغاء تحديدها، أو اختيار قيمة موجودة في قائمة منسدلة أو مجموعة أزرار اختيار. تُطبّق أول قاعدة مطابقة على كل حقل في كل صف. ارفع القاعدة في القائمة لإعطائها الأولوية. إذا لم تنطبق أي قاعدة، يأخذ الحقل قيمته من الربط المعتاد.

تُقارَن النصوص حرفيًا، مع التمييز بين حالة الحروف. يشمل اختبار الفراغ الخلايا التي تحتوي على مسافات بيضاء فقط. تتجاهل المقارنة الرقمية المسافات المحيطة وتقارن القيم العشرية بدقّة. لا يطابق الشرط الرقمي إلا القيم الرقمية. تعتمد القواعد على قيم الجدول الحالية بعد التعديلات والتنظيف. في إجراء كتابة النص، يستبدل البرنامج الرمز مثل `{{Role}}` بقيمة العمود ذي العنوان المطابق في خطوة واحدة. ثم يطبّق تنسيق الأرقام ويفحص حدّ المحارف وتوفّر الحروف واتساع الحقل لها.

اختر «جرّب مثال VIP وStandard الاصطناعي» لتحميل صفّين ببيانات خيالية. يكتب صفّ `VIP` النص `كبار الشخصيات / VIP` في حقل `Name` ويحدّد خانة `Consent`. يحتفظ صفّ `Standard` بالاسم المرتبط وتبقى خانة الموافقة فيه خالية. راجع عدد الصفوف التي تنطبق عليها كل قاعدة، واختر صفًا لمراجعة معاينة PDF. تسجّل تقارير الفحص بصيغتَي CSV وJSON القواعد المطبّقة في `ruleApplied`. [مثال من الطرفية باستخدام الإصدار 11](docs/subsystems/cli-automation.md#conditional-rule-walkthrough--تجربة-القواعد-الشرطية)

### تشغيل الدفعات من الطرفية

استخدم Node.js 24 ونسخة npm المرفقة معه. من مجلد الشفرة المصدرية، ثبّت الحزم باستخدام `npm ci --ignore-scripts`. يمكن أن يتّصل التثبيت بمستودع npm أو يستعين بذاكرة تخزين مؤقت مُعدّة مسبقًا. بعد التثبيت، تعالج الأداة ملفاتك دون اتصال باستخدام خطوط نوتو المضمّنة ومحرّكات PDF نفسها المتاحة في واجهة العمل.

```sh
npm run arabiform-cli -- --mode studio --template certificate-bilingual --out-dir ./arabiform-demo/starter
```

ينشئ `studio` قالبًا ثنائي اللغة قابلًا للتعبئة وجدول CSV اصطناعيًا مطابقًا. يفحص `preflight` دفعة CSV أو Excel ويكتب تقارير الفحص. ينتج `fill` أرشيفَي ZIP للملفات القابلة للتعديل والمسطّحة وملف PDF مدمجًا للطباعة. يجمع `packet` من قالبين إلى أربعة في ملف PDF مسطّح لكل شخص جاهز. يستخرج `extract` قيم الحقول المحفوظة من ملف PDF واحد إلى 200 ملف. يقارن `verify` بايتات الملف أو سجلّ رمز QR ببيان دفعة غير موقّع. يقارن `diff-template` إصدارَي قالب ويتيح ترحيل إعدادات الربط المحفوظة.

من واجهة تعبئة PDF، صدّر إعدادات الربط وافتح «أمر التشغيل المحلي» لنسخ أمر التعبئة بالإعدادات الحالية. مرّر ملف JSON مع `--preset` لاستخدام قواعد التحقّق والقواعد الشرطية وتنسيق الحقول وختم الطباعة في `preflight` و`fill`. يمنع `fill --strict` تصدير دفعة التعبئة عند إخفاق أي صف. رمز الخروج `0` للنجاح دون مشكلات، و`2` للتنبيه أو المنع، و`1` لخطأ في صيغة الأمر أو التعامل مع الملفات. قد ينتهي `packet` بالرمز `2` مع تصدير ملفات الأشخاص الجاهزين. وقد ينتهي `diff-template` بالرمز `2` بسبب تغيّرات في بنية القالب مع حفظ التقارير وإعدادات الربط المُرحّلة الصالحة. [أمثلة الطرفية والخيارات وملفات الإخراج](docs/subsystems/cli-automation.md)

استخدم `fill --imposition 4-up --print-certificate` للحصول على ملف الطباعة المدمج بأربعة سجلات لكل ورقة A4 وملف مستقل لشهادة ما قبل الطباعة. [تجربة بعينة اصطناعية](docs/subsystems/cli-automation.md#4-up-print-shop-walkthrough--تجربة-الطباعة-بأربعة-سجلات-لكل-ورقة)

استخدم `fill --dispatch-eml` مع عمود المستلم وقالبَي الموضوع والرسالة لإضافة أرشيف المسودات وسجلَّي التوزيع. استخدم `--redact-field` مع `preflight` أو `fill` لفحص قيم نسخ المراجعة وحجبها في التشغيل الحالي. [أمثلة إنشاء المسودات وحجب القيم من الطرفية](docs/subsystems/cli-automation.md#email-drafts-and-review-masks--مسودات-البريد-وحجب-القيم)

### التحقق محليًا

بعد تثبيت الحزم، يمكن تنفيذ الاختبارات بالملفات الاصطناعية المرفقة دون اتصال بالإنترنت. يشغّل `npm run test:fuzz` حالات مولّدة يمكن تكرارها، تشمل قراءة الجداول وتصميم الحقول وتعبئة النماذج والاستخراج منها، إلى جانب اتجاه النص والخطوط وتخطيط الطباعة والأختام وبصمات الملفات وحالات الإدخال والإخفاق في الطرفية. يتطلّب قبول M26 اجتياز 52,500 حالة على الأقل دون استبعاد أي حالة أو توقّف الاختبار، بما فيها تغيير رقم في IBAN أو تبديل محرفين متجاورين، وفحص السنوات الكبيسة والأصفار البادئة وتوافق الإعدادات المحفوظة. يقارن PyMuPDF مخرجات العينات بتكبير 4 أضعاف. افحص ملفًا تجريبيًا بقوالبك وبرنامج عرض PDF والطابعة قبل طباعة الدفعة. [شروط قبول M26](docs/tasks/M26-roster-schema-validator-iban-date-guards.md)

استخدم أوامر التحقق أعلاه مع Node.js 24 وPython 3.13. لمعاينة النسخة المبنية مع ترويسات الأمان، شغّل `npm run preview` بعد البناء. يتطلب `npm run test:e2e` تثبيت Microsoft Edge. على Windows، احتفظ بملفات العمل والملفات المؤقتة وذاكرات التخزين المؤقت على القرص `D:`. تُحفَظ صفحات الموقع الثابتة الخمس في `dist/`، وتُضبَط قيمة `SITE_URL` على عنوان الموقع الفعلي عند تجهيز نسخة للنشر. يجب أن يقلّ حجم JavaScript الذي تحمّله كل صفحة عند فتحها عن 274,000 بايت قبل الضغط وعن 85,800 بايت بعد ضغط gzip. [أوامر بناء الإصدار والتحقق من عنوان الموقع](docs/launch/cloudflare-pages-7day-launch.md#strict-origin-build)
