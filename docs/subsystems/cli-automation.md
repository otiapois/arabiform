# Local batch CLI / تشغيل الدفعات من الطرفية

## Setup / الإعداد

Use a checkout of ArabiForm with Node.js 24 and its bundled npm. Run the commands from the project root. Keep the source tree, installed packages and `public/fonts/` together on the machine running the jobs. A built `dist/` folder contains the static website. The CLI runs from the source checkout. Setup needs the npm registry or a populated npm cache. PDF processing runs offline after installation and uses the bundled Noto fonts. Node runs the CLI without a browser, a website build, or Python.

استخدم نسخة محلية من الشفرة المصدرية لـ ArabiForm مع Node.js 24 ونسخة npm المرفقة معه. نفّذ الأوامر من المجلد الرئيسي للمشروع. احتفظ بالشفرة والحزم المثبّتة ومجلد `public/fonts/` على الجهاز الذي ينفّذ الدفعات. يحتوي `dist/` على الموقع الثابت، وتعمل أداة الطرفية من مجلد الشفرة المصدرية. يتطلّب التثبيت الوصول إلى مستودع npm أو ذاكرة تخزين مؤقت تتوفر فيها الحزم. بعد التثبيت، تتم معالجة PDF دون اتصال باستخدام خطوط نوتو المضمّنة. يكفي Node لتشغيل الأداة دون متصفح أو بناء الموقع أو Python.

```sh
npm ci --ignore-scripts
```

Use `npm --silent run arabiform-cli -- …` for automation that reads the CLI's JSON directly. `--silent` removes the script banner printed by `npm run`. The `--` after the script name forwards the remaining arguments to ArabiForm.

استخدم `npm --silent run arabiform-cli -- …` عندما يقرأ برنامجك مخرجات JSON مباشرةً. يخفي `--silent` السطور التعريفية التي يطبعها `npm run`. تمرّر `--` بعد اسم الأمر الوسائط المتبقية إلى ArabiForm.

## Single-template walkthrough / تجربة تعبئة قالب واحد

Run these commands with a fresh `./arabiform-demo` path. The inputs are fictional. The same commands work in PowerShell and POSIX shells, with a shell-specific ZIP extraction command below.

نفّذ الأوامر بمسار جديد باسم `./arabiform-demo`. البيانات في المثال اصطناعية. تعمل الأوامر التالية في PowerShell وواجهات أوامر POSIX، ولكل منها أمر فكّ الأرشيف الموضّح أدناه.

```sh
npm run arabiform-cli -- --mode studio --template certificate-bilingual --out-dir ./arabiform-demo/starter
npm run arabiform-cli -- --mode preflight --template ./arabiform-demo/starter/certificate-bilingual.pdf --roster ./arabiform-demo/starter/certificate-bilingual-synthetic-sample.csv --date 2026-11-27 --out-dir ./arabiform-demo/check
npm run arabiform-cli -- --mode fill --template ./arabiform-demo/starter/certificate-bilingual.pdf --roster ./arabiform-demo/starter/certificate-bilingual-synthetic-sample.csv --date 2026-11-27 --strict --imposition 2-up --cover --out-dir ./arabiform-demo/filled
```

Unpack `arabiform-editable.zip` before running `extract`. Use PowerShell or a POSIX shell as shown.

فكّ ضغط `arabiform-editable.zip` قبل تشغيل `extract`. استخدم الأمر المناسب لواجهة الأوامر لديك.

```powershell
Expand-Archive -LiteralPath ./arabiform-demo/filled/arabiform-editable.zip -DestinationPath ./arabiform-demo/editable
```

```sh
unzip ./arabiform-demo/filled/arabiform-editable.zip -d ./arabiform-demo/editable
```

```sh
npm run arabiform-cli -- --mode extract --in-dir ./arabiform-demo/editable --out-dir ./arabiform-demo/extracted
npm run arabiform-cli -- --mode verify --manifest ./arabiform-demo/filled/custody-manifest.json --variant merged ./arabiform-demo/filled/arabiform-merged.pdf
```

## Conditional rule walkthrough / تجربة القواعد الشرطية

Save this fictional roster as `./arabiform-rules.csv` in UTF-8. Use the repository’s synthetic clinic template, which has the `Name`, `ID`, and `Consent` fields.

احفظ هذا الجدول الخيالي باسم `./arabiform-rules.csv` بترميز UTF-8. استخدم قالب العيادة الاصطناعي المرفق بالمشروع، وفيه الحقول `Name` و`ID` و`Consent`.

```csv
Name,ID,Consent,Role
ليلى حسن,00001,false,VIP
أحمد سالم,00002,false,Standard
```

Save the version 11 preset as `./arabiform-rules.json` in UTF-8.

احفظ إعدادات الربط بالإصدار 11 باسم `./arabiform-rules.json` بترميز UTF-8.

```json
{
  "version": 11,
  "mapping": { "Name": "Name", "ID": "ID", "Consent": "Consent" },
  "filenamePattern": "{{ID}}",
  "minFontSize": 8,
  "font": "auto",
  "flattenZip": false,
  "includeCoverSheet": false,
  "alignOverrides": {},
  "watermark": { "kind": "none" },
  "virtualMappings": {},
  "qrStamp": { "placement": "none" },
  "coverLanguage": "auto",
  "imposition": "1-up",
  "groupByColumn": null,
  "fieldTypography": {},
  "approvalSeal": null,
  "conditionalRules": [
    { "field": "Name", "column": "Role", "operator": "equals", "operand": "VIP", "action": { "type": "set-text", "value": "كبار الشخصيات / {{Role}}" } },
    { "field": "Consent", "column": "Role", "operator": "equals", "operand": "VIP", "action": { "type": "set-checkbox", "checked": true } }
  ]
}
```

Use fresh output directories. The VIP PDF stores `كبار الشخصيات / VIP` in `Name` and checks both widgets for `Consent`. The Standard PDF keeps `أحمد سالم` in `Name` and its `Consent` widgets unchecked. The preflight CSV and JSON record `[{"field":"Name","ruleIndex":1},{"field":"Consent","ruleIndex":2}]` for the first row and `[]` for the second. The rule index is its 1-based position in `conditionalRules`.

استخدم مجلدات إخراج جديدة. يحفظ ملف صفّ `VIP` النص `كبار الشخصيات / VIP` في حقل `Name` ويحدّد موضعَي خانة `Consent`. يحتفظ ملف صفّ `Standard` بالاسم `أحمد سالم` وتبقى خانتا الموافقة فيه خاليتين. يسجّل تقرير الفحص بصيغتَي CSV وJSON القاعدتين 1 و2 للصفّ الأول وقائمة فارغة `[]` للصفّ الثاني. يبدأ ترقيم مواضع القواعد في قائمة `conditionalRules` من 1.

```sh
npm run arabiform-cli -- --mode preflight --template ./fixtures/m3/clinic-consent-mixed.pdf --roster ./arabiform-rules.csv --preset ./arabiform-rules.json --out-dir ./arabiform-demo/rules-check
npm run arabiform-cli -- --mode fill --template ./fixtures/m3/clinic-consent-mixed.pdf --roster ./arabiform-rules.csv --preset ./arabiform-rules.json --strict --out-dir ./arabiform-demo/rules-filled
```

## Packet walkthrough / تجربة تجميع الحزم

Save the following JSON as `./packet-mappings.json` in UTF-8 without a byte order mark. Each object maps PDF field names to exact headers in the shared roster. The array follows the order of the repeated `--template` arguments. Use `null` in a slot to auto-map the text and checkbox fields of that template. Omit `--mappings` to auto-map every template. Each template needs at least one mapping. Fields left out of an explicit mapping keep their original visible appearances in print.

احفظ JSON التالي في ملف `./packet-mappings.json` بترميز UTF-8 بلا علامة BOM. يربط كل كائن أسماء حقول PDF بعناوين أعمدة مطابقة في الجدول المشترك. يتبع ترتيب عناصر القائمة ترتيب خيارات `--template`. استخدم `null` في موضع قالب لربط حقوله النصية وخانات الاختيار تلقائيًا. احذف `--mappings` للربط التلقائي في جميع القوالب. يحتاج كل قالب إلى حقل مرتبط واحد على الأقل. تحتفظ الحقول التي تتركها خارج الربط الصريح بمظهرها المرئي عند الطباعة.

```json
[
  { "Employee": "Name" },
  { "Name": "Name", "ID": "ID", "Consent": "Consent" }
]
```

Use the bundled synthetic HR and clinic templates with one synthetic CSV. Choose a fresh output path. The cover is one page, the HR document starts on page 2, and the clinic document starts on page 4. Grouping creates folders from the `Consent` column. The last roster row deliberately has an invalid checkbox value. The command exits `2` and still writes packets for the first two rows.

استخدم قالبَي الموارد البشرية والعيادة وجدول CSV الاصطناعي المرفق. اختر مسار إخراج جديدًا. يتكوّن الغلاف من صفحة واحدة، ويبدأ مستند الموارد البشرية في الصفحة 2، ويبدأ مستند العيادة في الصفحة 4. ينظّم خيار التجميع الملفات في مجلدات بحسب عمود `Consent`. يحتوي الصف الأخير عمدًا على قيمة غير صالحة لخانة اختيار. يخرج الأمر بالرمز `2` ويكتب حزم الصفّين الأولَين.

```sh
npm run arabiform-cli -- --mode packet --template ./fixtures/m4/multi-page-hr-choices.pdf --template ./fixtures/m3/clinic-consent-mixed.pdf --roster ./fixtures/m3/clinic-consent-roster.csv --mappings ./packet-mappings.json --group-by Consent --cover --out-dir ./arabiform-demo/packets
```

The ZIP contains one flattened PDF per ready recipient. The packet manifest is a separate JSON file. `verify` reads the single-template batch receipts described below. For a packet, compare SHA-256 for the exact source or extracted PDF bytes with the corresponding digest in a trusted copy of `packet-custody-manifest.json`. The manifest is unsigned. Issuer authenticity requires separate evidence. [Packet manifest fields](pdf-engine.md#multi-template-packet-assembly)

يحتوي ZIP على ملف PDF مسطّح لكل شخص جاهز. يُحفظ بيان الحزم في ملف JSON مستقل. يقرأ `verify` بيانات دفعات القالب الواحد المذكورة أدناه. للتحقّق من حزمة، احسب بصمة SHA-256 للبايتات الأصلية للمصدر أو لملف PDF المستخرج من الأرشيف، وقارنها بالبصمة المقابلة في نسخة موثوقة من `packet-custody-manifest.json`. البيان غير موقّع. يتطلّب إثبات هوية الجهة المصدرة دليلًا منفصلًا. [حقول بيان الحزم](pdf-engine.md#multi-template-packet-assembly)

## Template comparison walkthrough / تجربة مقارنة القوالب

Use the bundled synthetic offer templates and version 11 preset. `offer-rename-map.json` maps `FullName` from the old template to `EmployeeFullName` in the new one. A rename map is a JSON object of exact old field names and their replacement names, such as `{"FullName":"EmployeeFullName"}`. Use a fresh output directory.

استخدم قالبَي العرض الاصطناعيَّين وإعدادات الربط المرفقة بالإصدار 11. يربط `offer-rename-map.json` الحقل القديم `FullName` بالحقل الجديد `EmployeeFullName`. ملف إعادة التسمية كائن JSON يربط أسماء الحقول القديمة بأسماء بدائلها حرفيًا، مثل `{"FullName":"EmployeeFullName"}`. استخدم مجلد إخراج جديدًا.

```sh
npm run arabiform-cli -- --mode diff-template --old ./fixtures/m23/2026-offer.pdf --new ./fixtures/m23/2027-offer.pdf --preset ./fixtures/m23/offer-preset-v11.json --rename-map ./fixtures/m23/offer-rename-map.json --out-dir ./arabiform-demo/migration
```

The sample exits `2` because the revised template has structural changes that can affect filling. It writes `template-migration-report.csv`, `template-migration-report.json`, and `migrated-preset.json` because the supplied rename resolves the affected preset references. Review the reports, then preflight the roster using the revised PDF and migrated preset.

تخرج المقارنة في هذا المثال بالرمز `2` لأن القالب الجديد يتضمّن تغيّرات بنيوية قد تؤثّر في التعبئة. تُكتب الملفات `template-migration-report.csv` و`template-migration-report.json` و`migrated-preset.json` لأن إعادة التسمية تحلّ مراجع الحقول المتأثّرة في الإعدادات. راجع التقريرَين، ثم افحص جدول البيانات بالقالب الجديد والإعدادات المُرحّلة.

```sh
npm run arabiform-cli -- --mode preflight --template ./fixtures/m23/2027-offer.pdf --roster ./fixtures/m23/offer-roster.csv --preset ./arabiform-demo/migration/migrated-preset.json --out-dir ./arabiform-demo/revised-check
```

## Modes and output / الأوضاع والمخرجات

| `--mode` | English | العربية |
| --- | --- | --- |
| `studio` | Requires a starter ID in `--template` and `--out-dir`. Writes `<id>.pdf` and `<id>-synthetic-sample.csv`. The PDF is an editable AcroForm. The matching UTF-8 BOM CSV contains synthetic rows. | يتطلّب معرّف القالب في `--template` ومسار الإخراج في `--out-dir`. ينشئ قالب AcroForm قابلًا للتعبئة باسم `<id>.pdf` وجدولًا اصطناعيًا مطابقًا باسم `<id>-synthetic-sample.csv` بترميز UTF-8 وعلامة BOM. |
| `diff-template` | Requires `--old`, `--new`, and `--out-dir`. A completed comparison writes `template-migration-report.csv` and `template-migration-report.json`. Adds `migrated-preset.json` when a supplied preset passes migration validation. | يتطلّب `--old` و`--new` و`--out-dir`. عند اكتمال المقارنة يكتب `template-migration-report.csv` و`template-migration-report.json`، ويضيف `migrated-preset.json` إذا اجتازت إعدادات الربط المقدّمة فحص الترحيل. |
| `preflight` | Requires `--template`, `--roster`, and `--out-dir`. Checks mapping and values, including glyph fit, and writes `arabiform-preflight.csv` and `arabiform-preflight.json`. The files describe each row or the reason intake was blocked. | يتطلّب `--template` و`--roster` و`--out-dir`. يفحص الربط والقيم ومدى اتساع الحقول للحروف، ثم يكتب `arabiform-preflight.csv` و`arabiform-preflight.json` بتفاصيل كل صف أو سبب رفض المدخلات. |
| `fill` | Requires `--template`, `--roster`, and `--out-dir`. Runs preflight and, for an exportable batch, writes `arabiform-editable.zip`, `arabiform-flattened.zip`, `arabiform-merged.pdf`, and `custody-manifest.json`. It makes both ZIP variants on every successful export. Grouping changes the paths in both ZIPs and keeps the printable PDF combined. | يتطلّب `--template` و`--roster` و`--out-dir`. يجري الفحص المسبق ويكتب `arabiform-editable.zip` و`arabiform-flattened.zip` و`arabiform-merged.pdf` و`custody-manifest.json` للدفعة القابلة للتصدير. ينتج التصدير أرشيفَي ZIP، ويغيّر التجميع المسارات داخلهما مع إبقاء كل السجلات في ملف الطباعة المدمج. |
| `packet` | Requires two to four `--template` arguments, `--roster`, and `--out-dir`. Writes `arabiform-packets.zip` and `packet-custody-manifest.json` when at least one person is ready. | يتطلّب تكرار `--template` من مرتين إلى أربع مرات، مع `--roster` و`--out-dir`. يكتب `arabiform-packets.zip` و`packet-custody-manifest.json` عند وجود شخص جاهز واحد على الأقل. |
| `extract` | Requires `--out-dir` and either `--in-dir` or 1–200 positional PDF paths. Reads saved form fields and writes `arabiform-extracted.csv` (UTF-8 BOM), `arabiform-extracted.xlsx` (text cells) and `extraction-audit.json`. | يتطلّب `--out-dir` ومجلدًا في `--in-dir` أو قائمة تضم من مسار PDF واحد إلى 200 مسار. يقرأ الحقول المحفوظة ويكتب `arabiform-extracted.csv` بترميز UTF-8 وعلامة BOM، و`arabiform-extracted.xlsx` بخلايا نصية، و`extraction-audit.json`. |
| `verify` | Requires `--manifest` and either one or more positional PDF paths or `--qr-payload`. Writes results as JSON to stdout. | يتطلّب `--manifest` ومسار PDF واحدًا أو أكثر، أو `--qr-payload`. يكتب النتائج بصيغة JSON إلى المخرج القياسي. |

`studio` template IDs / معرّفات قوالب `studio`

- `certificate-bilingual` — A4 landscape completion certificate / شهادة إتمام أفقية بمقاس A4
- `hr-letter-bilingual` — A4 portrait employment letter / خطاب إثبات عمل عمودي بمقاس A4
- `clinic-consent-bilingual` — A4 portrait clinic consent form / نموذج موافقة للمريض عمودي بمقاس A4
- `visitor-badge-a6` — A6 landscape visitor badge / بطاقة زائر أفقية بمقاس A6

## Flag reference / خيارات الأوامر

| Flag | English | العربية |
| --- | --- | --- |
| `--help` | Print usage and exit `0`. Use it on its own. | يعرض طريقة الاستخدام ويخرج بالرمز `0`. استخدمه بمفرده. |
| `--mode <name>` | Select a mode from the table above. | يحدّد أحد الأوضاع المذكورة في الجدول أعلاه. |
| `--out-dir <dir>` | Local output directory for `studio`, `diff-template`, `preflight`, `fill`, `packet` and `extract`. The CLI creates missing directories and refuses to overwrite outputs. Directory paths through symbolic links or junctions are rejected. | مجلد إخراج محلي للأوضاع `studio` و`diff-template` و`preflight` و`fill` و`packet` و`extract`. تُنشئ الأداة المجلدات الناقصة وترفض الكتابة فوق المخرجات الموجودة. تُرفض مسارات المجلدات التي تمر عبر رابط رمزي أو نقطة وصل في Windows. |
| `--template <pdf>` / `--template <id>` | Source template for `preflight` or `fill`, or a built-in template ID for `studio`. For `packet`, repeat `--template <pdf>` two to four times in document order. | مسار القالب المصدر في `preflight` أو `fill`، أو معرّف قالب مضمّن في `studio`. في `packet`، كرّر `--template <pdf>` من مرتين إلى أربع مرات بحسب ترتيب المستندات. |
| `--old <pdf>` / `--new <pdf>` | The original and revised AcroForm PDFs for `diff-template`. | مسارا قالبَي AcroForm القديم والجديد في `diff-template`. |
| `--roster <csv-or-xlsx>` | Source roster for `preflight`, `fill`, or `packet`. All templates in `packet` use the same roster. | جدول البيانات المصدر في `preflight` أو `fill` أو `packet` بصيغة CSV أو Excel. تستخدم جميع قوالب `packet` الجدول نفسه. |
| `--preset <json>` | A workbench mapping preset (versions 1–11) to reuse in `preflight` or `fill`, or migrate in `diff-template`. | ملف إعدادات الربط من واجهة العمل (الإصدارات 1 إلى 11) لاستخدامه في `preflight` أو `fill`، أو ترحيله في `diff-template`. |
| `--rename-map <json>` | Optional old-to-new field name map for `diff-template`. Requires `--preset`. | ملف JSON اختياري يربط أسماء الحقول القديمة بالجديدة في `diff-template`. يتطلّب `--preset`. |
| `--mappings <json>` | Optional ordered JSON array of field-to-header maps or `null` for `packet`. Supply one entry per template. | قائمة JSON اختيارية تحتوي على تعريف ربط الحقول بعناوين الأعمدة، أو على `null`، لكل قالب في `packet`. اتّبع ترتيب القوالب. |
| `--sheet <name>` | Exact visible Excel worksheet name for `preflight`, `fill`, or `packet`. By default, load the first visible worksheet. | اسم ورقة العمل الظاهرة في `preflight` أو `fill` أو `packet` كما كُتب في ملف Excel. تُحمَّل أول ورقة ظاهرة افتراضيًا. |
| `--sheet-base64url <name>` | Encoded equivalent of `--sheet` for shells that have trouble passing a worksheet name. Use canonical UTF-8 base64url with no padding. Supply just one of the two forms. | بديل مرمّز لـ `--sheet` عندما يصعب تمرير اسم الورقة عبر واجهة الأوامر. استخدم UTF-8 بترميز base64url القياسي دون حشو، واختر إحدى الصيغتين. |
| `--group-by <header>` | Exact roster header for `preflight`, `fill`, or `packet`. Plans one folder per value, including `_Ungrouped` for blanks. Single-template preflight diagnostics record the member paths. | اسم عمود الجدول حرفيًا في `preflight` أو `fill` أو `packet`. يحدّد مجلدًا لكل قيمة ومجلد `_Ungrouped` للقيم الفارغة. تسجّل تقارير فحص القالب الواحد مسارات الملفات. |
| `--group-by-base64url <header>` | Encoded equivalent of `--group-by`. Use canonical UTF-8 base64url with no padding. Supply just one of the two forms. | بديل مرمّز لـ `--group-by`. استخدم UTF-8 بترميز base64url القياسي دون حشو، واختر إحدى الصيغتين. |
| `--date YYYY-MM-DD` | Date for virtual roster values and print cover dates in `preflight` or `fill`. The default is the current UTC date. Pin the date to repeat a run with date-based fields or a cover. | تاريخ القيم المحسوبة وأغلفة الطباعة في `preflight` أو `fill`. التاريخ الافتراضي هو اليوم بالتوقيت العالمي UTC. حدّده عند تكرار دفعة تستخدم التاريخ في الحقول أو الغلاف. |
| `--strict` | For `fill`, exit `2` with JSON diagnostics on stderr and write no output files if any row fails preflight. | في `fill`، يكتب تفاصيل الإخفاق بصيغة JSON إلى مخرج الأخطاء القياسي ويخرج بالرمز `2` دون إنشاء ملفات إذا أخفق أي صف. |
| `--imposition 1-up` or `--imposition 2-up` | Merged PDF layout in `fill`. `2-up` places two single-page records per A4 sheet. Use `1-up` for multi-page templates since `2-up` stops the export. | تخطيط PDF المدمج في `fill`. يضع `2-up` سجلين من صفحة واحدة على ورقة A4. استخدم `1-up` مع القوالب متعددة الصفحات لأن `2-up` يوقف تصديرها. |
| `--cover` | In `fill`, adds an index cover to the merged PDF using the preset's cover language, or English when set to `auto` or omitted. In `packet`, adds a bilingual cover with a document index to each packet PDF. | في `fill` يضيف غلافًا بفهرس إلى ملف PDF المدمج بلغة الغلاف المحفوظة، أو بالإنجليزية إذا كانت اللغة `auto` أو غير محدّدة. في `packet` يضيف غلافًا ثنائي اللغة بفهرس المستندات إلى كل حزمة PDF. |
| `--watermark <text>` | Adds a one-line watermark of up to 32 Unicode code points in `fill`. It uses a 45° angle and 14% opacity. Print marks apply to flattened record pages. | يضيف علامة مائية من سطر واحد يصل إلى 32 محرفًا بترميز Unicode في `fill`. تكون الزاوية 45° والعتامة 14%. تظهر علامات الطباعة على صفحات السجلات المسطّحة. |
| `--qr` | Enables a custody QR stamp for `fill` print outputs and records the stamped rows in the receipt. Uses the preset's active corner and size, or bottom right at 48 pt. A preset's custom QR pattern applies if `--qr` is omitted. | يفعّل ختم QR لسجلّ الحيازة في مخرجات طباعة `fill`، ويسجّل الصفوف المختومة في البيان. يستخدم الزاوية والمقاس الفعّالين في الإعدادات، أو الزاوية اليمنى السفلى بمقاس 48 نقطة. يُستخدم نمط QR المخصّص المحفوظ إذا حُذف `--qr`. |
| `--in-dir <dir>` | In `extract`, read regular `.pdf` files from the top level of this directory in filename order. For a grouped ZIP, list the unpacked PDF paths explicitly to set the input order. | في `extract`، يقرأ ملفات `.pdf` العادية في المستوى الأول من المجلد حسب ترتيب الأسماء. مع أرشيف ZIP المجمّع، مرّر مسارات ملفات PDF بعد فك الضغط لتحديد ترتيب الإدخال. |
| `--manifest <json>` | Unsigned custody manifest for `verify`. | بيان حيازة غير موقّع يقرأه `verify`. |
| `--variant <name>` | In `verify` with a v2 CLI receipt, restrict PDF matching to `editable`, `flattened`, or `merged`. Omit to check available output variants or to use a v1 receipt. | في `verify` مع بيان الطرفية بالإصدار 2، يحصر مطابقة PDF في `editable` للقابل للتعديل أو `flattened` للمسطّح أو `merged` للمدمج. احذفه للمقارنة مع الأنواع المتوفرة أو لاستخدام بيان بالإصدار 1. |
| `--qr-payload <text>` | In `verify`, check one scanned custody QR text. Supply it in place of PDF paths. | في `verify`، يفحص نص رمز QR مقروءًا من ختم الحيازة. مرّر النص مكان مسارات PDF. |

Quote paths and names with spaces. Options take a separate value such as `--imposition 2-up`. In `extract` and `verify`, a second `--` after the CLI options makes every remaining argument a PDF path. To encode an exact sheet name or header as base64url, use, for example, `node -p "Buffer.from('Branch Name', 'utf8').toString('base64url')"`. Pass the result to the corresponding encoded flag.

ضع المسارات والأسماء التي تحتوي على مسافات بين علامتَي اقتباس. مرّر قيمة الخيار كوسيط مستقل مثل `--imposition 2-up`. في `extract` و`verify`، يمكن وضع `--` ثانية بعد الخيارات لتمرير بقية الوسائط كمسارات PDF. لترميز اسم ورقة أو عمود حرفيًا، استخدم مثلًا `node -p "Buffer.from('Branch Name', 'utf8').toString('base64url')"`. مرّر الناتج إلى الخيار المرمّز المقابل.

Use a relative path beneath the current directory, such as `./inputs/template.pdf`, or a local absolute path. The CLI rejects segments such as `..`, UNC paths and unsafe filename components such as reserved Windows device names. Use a new output directory when repeating a run with the same filenames.

استخدم مسارًا نسبيًا داخل المجلد الحالي مثل `./inputs/template.pdf`، أو مسارًا محليًا مطلقًا. ترفض الأداة المقاطع مثل `..` ومسارات UNC ومكوّنات الأسماء غير الآمنة مثل أسماء أجهزة Windows المحجوزة. استخدم مجلد إخراج جديدًا عند تكرار التشغيل بأسماء الملفات نفسها.

## Presets, limits and exit codes / إعدادات الربط والحدود ورموز الخروج

In Fill PDFs, save a mapping preset after checking the source template and worksheet. Open **Local CLI command** beside the preset controls to copy a strict fill command. Replace the example paths and save any browser edits in the source roster before running it. Without a preset, the CLI auto-maps text and checkbox fields. To fill dropdowns or radio groups, map their columns in the workbench and pass the saved preset. The preset supplies the mapping, bundled font, minimum size, output name pattern and print settings. Mapped fields and headers must exist in the supplied files. A mismatch blocks the run.

في واجهة تعبئة PDF، احفظ إعدادات الربط بعد فحص القالب وورقة العمل. افتح «أمر التشغيل المحلي» بجوار أزرار الإعدادات لنسخ أمر التعبئة الصارم. استبدل مسارات المثال واحفظ تعديلات المتصفح في الجدول المصدر قبل تشغيل الأمر. تُربط حقول النص وخانات الاختيار تلقائيًا عند عدم تمرير ملف إعدادات. لتعبئة القوائم المنسدلة أو مجموعات أزرار الاختيار، اربط أعمدتها في واجهة العمل ومرّر ملف الإعدادات. يحدّد الملف ربط الحقول والخط المضمّن والحد الأدنى لحجم الخط ونمط تسمية الملفات وإعدادات الطباعة المحفوظة. يجب أن تتوفّر الحقول وعناوين الأعمدة المربوطة في الملفات المقدّمة. يتوقّف التشغيل عند عدم تطابقها.

Version 10 reuses the text fields’ numeral, line height, and inner padding settings and the optional bilingual approval seal. With `--preset`, both `preflight` and `fill` use the same field fit checks as the workbench. The seal’s placement is checked when `fill` prepares the print output. It appears on flattened ZIP members and merged print pages, including 2-up when selected. If the seal collides with a visible field or QR stamp, the page is too small, or the text cannot be rendered, `fill` exits with code `2` before writing the batch artifacts. [Print seal contract](pdf-engine.md#responsibilities)

يعيد الإصدار 10 استخدام إعدادات الأرقام وارتفاع السطر والحاشية الداخلية للحقول النصية، وختم الاعتماد الثنائي اللغة عند تفعيله. مع `--preset` يستخدم `preflight` و`fill` فحوص ملاءمة النص نفسها المستخدمة في واجهة العمل. يُفحص موضع الختم عندما يجهّز `fill` مخرجات الطباعة. يظهر الختم في ملفات ZIP المسطّحة وصفحات PDF المدمجة، بما فيها تخطيط سجلّين لكل ورقة عند اختياره. إذا تداخل الختم مع حقل مرئي أو رمز QR، أو ضاقت مساحة الصفحة، أو تعذّر رسم النص، يتوقّف `fill` برمز الخروج `2` قبل كتابة ملفات الدفعة. [قواعد ختم الطباعة](pdf-engine.md#responsibilities)

Version 11 extends those settings with ordered conditional rules. Both modes apply the first matching rule per mapped field to the supplied roster before numeral formatting and PDF fit checks. A bad rule reference or choice flags the row with a field diagnostic. Preflight CSV stores `ruleApplied` as JSON inside a CSV cell, and the JSON audit and CLI row results store it as an array. Presets from versions 1–10 continue to use their existing behavior. [Rule and column semantics](roster-mapper.md#conditional-field-rules)

يضيف الإصدار 11 قائمة مرتّبة من القواعد الشرطية إلى هذه الإعدادات. في كلا الوضعين، تُطبّق أول قاعدة مطابقة لكل حقل مرتبط بالجدول المقدّم قبل تنسيق الأرقام وفحص اتساع حقل PDF للنص. يظهر تنبيه باسم الحقل في الصف إذا احتوت القاعدة على مرجع غير صالح أو خيار غير متاح. يخزّن تقرير CSV قائمة `ruleApplied` بصيغة JSON داخل خلية، وتظهر كمصفوفة في تقرير JSON ونتائج الصفوف في الطرفية. تعمل الإعدادات من الإصدار 1 إلى 10 بالطريقة المعتادة. [تفاصيل القواعد والأعمدة](roster-mapper.md#conditional-field-rules)

An explicit flag overrides the corresponding preset value. `--sheet` and `--date` apply to this run. `--cover` and `--qr` enable their settings. To turn a saved option off, update the preset in the workbench. Each export includes both ZIP variants regardless of the preset's ZIP preference. Selected rows, inline edits, local custom fonts, cover source fingerprints and saved batch drafts stay outside the mapping preset.

تتقدّم قيمة الخيار الصريح على القيمة المقابلة في الملف. يُطبَّق `--sheet` و`--date` على التشغيل الحالي. يفعّل `--cover` و`--qr` إعداداتهما. لتعطيل إعداد محفوظ، غيّره في واجهة العمل واحفظ الإعدادات مجددًا. يشمل كل تصدير أرشيفَي ZIP بصرف النظر عن نوع الأرشيف المحفوظ في الإعدادات. تبقى الصفوف المحددة وتعديلات الخلايا والخطوط المحلية المخصّصة وبصمات المصادر على الغلاف ومسودّات الدفعات خارج ملف إعدادات الربط.

Fill needs an editable AcroForm with supported fields. Intake blocks signed, encrypted and XFA PDFs. Extraction needs saved interactive values. It reports unreadable files and flat or scanned PDFs without saved fields. Use editable ZIP members for extraction. Workbook formulas use their cached results, and Excel warnings describe source data that may already have lost digits or leading zeros. Finished archives and merged PDFs are built in memory. Split large jobs to fit the available memory and test a representative batch with your own template before using the results in production. [PDF engine limits](pdf-engine.md) · [Roster and grouping rules](roster-mapper.md)

تتطلّب التعبئة نموذج AcroForm بحقول قابلة للتعديل ومدعومة. ترفض الأداة ملفات PDF الموقّعة والمشفّرة ونماذج XFA. يقرأ الاستخراج قيم الحقول التفاعلية المحفوظة، ويبيّن الملفات التي تعذّرت قراءتها والملفات المسطّحة أو الممسوحة ضوئيًا التي تخلو من الحقول. استخدم ملفات ZIP القابلة للتعديل للاستخراج. يعتمد قارئ Excel على النتائج المحفوظة للصيغ، ويبيّن أي تنبيه إلى أرقام أو أصفار بادئة ربما فُقدت من بيانات المصدر. تتجمّع محتويات الأرشيف وملف PDF المدمج في الذاكرة. قسّم الدفعات الكبيرة بما يناسب الذاكرة المتاحة، وجرّب دفعة مماثلة بقالَبك قبل استخدام النتائج في العمل. [حدود محرّك PDF](pdf-engine.md) · [قواعد الجداول والتجميع](roster-mapper.md)

| Code / الرمز | English | العربية |
| --- | --- | --- |
| `0` | Clean result. In `verify`, successful PDF byte matches or a successful QR membership match. | نتيجة سليمة. وفي `verify` يعني تطابق بايتات PDF أو وجود سجل رمز QR في البيان. |
| `1` | Invalid command arguments or file I/O error. | وسائط أمر غير صالحة أو خطأ في قراءة الملفات أو كتابتها. |
| `2` | Flagged or blocked result. `preflight` writes row or intake diagnostics. `fill --strict` writes no files on preflight failure. Without `--strict`, `fill` can export ready rows and still exit `2`. An `extract` that finds blocked files or schema differences writes spreadsheets and the audit before exiting `2`. A mismatching or unknown verification result also exits `2`. | نتيجة تتضمّن تنبيهًا أو منعًا. يكتب `preflight` تفاصيل الصفوف أو سبب رفض المدخلات. يخرج `fill --strict` دون كتابة ملفات عند إخفاق الفحص. قد يصدّر `fill` دون `--strict` الصفوف الجاهزة مع رمز الخروج `2`. يكتب `extract` الجدولين وتقرير التدقيق ويخرج بالرمز `2` إذا تعذّرت قراءة ملفات أو اختلفت بنية الحقول بينها. يخرج التحقّق أيضًا بالرمز `2` عند اختلاف البايتات أو غياب نتيجة مطابقة. |

The CLI writes result JSON to stdout. When `fill` is blocked, including when zero rows are ready, it writes diagnostic JSON to stderr. Run `preflight` separately to save the diagnostic files. `packet` writes a `clean` result to stdout with exit `0`, or a `flagged` result to stdout with exit `2` when some recipients are held and others export. If every recipient is held or the inputs block the batch, `packet` writes diagnostics to stderr, exits `2`, and writes no packet files. Invalid arguments, malformed JSON inputs, and file I/O errors also use stderr and exit `1`.

تكتب الأداة نتائج JSON إلى المخرج القياسي. عند توقّف `fill`، بما في ذلك غياب أي صف جاهز، تكتب تفاصيل JSON إلى مخرج الأخطاء القياسي. شغّل `preflight` وحده لحفظ ملفات الفحص. يكتب `packet` نتيجة `clean` إلى المخرج القياسي ويخرج بالرمز `0`، أو يكتب `flagged` ويخرج بالرمز `2` عند تصدير بعض الحزم مع توقّف حزم أخرى. إذا توقّفت كل الحزم أو منعت المدخلات معالجة الدفعة، يكتب `packet` التفاصيل إلى مخرج الأخطاء ويخرج بالرمز `2` دون كتابة ملفات حزم. وتُكتب أخطاء الوسائط أو صيغة JSON أو التعامل مع الملفات إلى مخرج الأخطاء مع رمز الخروج `1`.

`diff-template` exits `0` for a completed comparison without breaking changes or migration blockers. It exits `2` when either PDF fails intake, the comparison finds breaking changes such as a smaller widget, or preset migration is blocked. A completed comparison still writes both reports. It can also write a migrated preset with exit `2` if its references are valid and structural warnings remain. A blocked PDF intake produces no report files. Use `preflight` separately to check the roster.

يخرج `diff-template` بالرمز `0` عندما تكتمل المقارنة دون تغيّرات تخلّ بالتوافق أو عوائق أمام الترحيل. ويخرج بالرمز `2` إذا رُفض أحد الملفَّين، أو أظهرت المقارنة تغيّرًا يخلّ بالتوافق مثل صغر مساحة أحد الحقول، أو تعذّر ترحيل الإعدادات. عند اكتمال المقارنة تُكتب نسختا التقرير، وقد يُكتب ملف إعدادات مُرحّل رغم رمز الخروج `2` إذا كانت مراجع الإعدادات صالحة وبقيت تنبيهات تتعلّق ببنية القالب. إذا رُفض ملف PDF عند فتحه فلن تُكتب التقارير. استخدم `preflight` في خطوة منفصلة لفحص جدول البيانات.

## Custody checks / التحقّق من بيان الحيازة

`fill` writes an unsigned version 2 receipt with source hashes, original row numbers, and SHA-256 for the final PDF bytes. `entries` covers the editable ZIP members, `flattenedEntries` covers the flattened members, and `mergedPdfSha256` covers the merged print PDF. A grouped member records its `zipPath`. An explicit Excel sheet selection is recorded in `sheetName`. The CLI also reads earlier version 1 batch receipts. Keep a trusted copy of the receipt separately if you need to compare a delivered file later.

يكتب `fill` بيانًا غير موقّع بالإصدار 2 يضمّ بصمات المصادر وأرقام الصفوف الأصلية وبصمات SHA-256 لبايتات PDF النهائية. يصف `entries` الملفات القابلة للتعديل داخل ZIP، ويصف `flattenedEntries` الملفات المسطّحة، ويغطي `mergedPdfSha256` ملف الطباعة المدمج. يسجّل بيان الملف المجمّع أيضًا مساره في `zipPath`. عند تحديد ورقة Excel صراحةً يُسجَّل اسمها في `sheetName`. تقرأ الأداة كذلك بيانات الدفعات السابقة بالإصدار 1. احتفظ بنسخة موثوقة من البيان في مكان منفصل إذا أردت مقارنة ملف مستلَم لاحقًا.

For a PDF, `VERIFIED_EXACT_MATCH` confirms that the complete SHA-256 matches a recorded output. `TAMPERED_BYTE_MISMATCH` means a known output name or path has different bytes. `UNMATCHED_UNKNOWN` means the receipt supplies no corresponding match. Keep the grouping folder when passing a member of a grouped ZIP so that the CLI can match the exact path. To check a PDF expected to be flattened even when an editable member has the same name, pass `--variant flattened`. A v2 receipt result identifies the variant and member path when the match uniquely identifies the output.

بالنسبة إلى PDF، يعني `VERIFIED_EXACT_MATCH` تطابق بصمة SHA-256 الكاملة مع أحد المخرجات المسجّلة. وتعني `TAMPERED_BYTE_MISMATCH` أن اسم المخرج أو مساره معروف لكن بايتاته مختلفة. وتعني `UNMATCHED_UNKNOWN` أن البيان لا يحتوي على نتيجة مطابقة. عند تمرير ملف من ZIP مجمّع، أبقِه داخل مجلد مجموعته لتتمكّن الأداة من مطابقة المسار الحرفي. استخدم `--variant flattened` عند توقّع ملف مسطّح يحمل اسمًا يطابق اسم ملف قابل للتعديل. تُبيّن نتيجة التحقّق ببيان من الإصدار 2 نوع المخرج ومسار الملف عند تحديد مخرج واحد مطابق.

For a custody stamp, run `verify --manifest` with the actual `--qr-payload` text read from the PDF or printed page. `VERIFIED_QR_RECORD` confirms membership of the stamped row in the supplied receipt. Use the PDF input separately to check its bytes. Custom QR patterns carry their own text. Only custody stamps record row membership in the manifest. Both kinds of verification depend on the supplied unsigned receipt. Issuer authenticity requires separate evidence. [How custody digests and QR records are built](pdf-engine.md#custody-manifest)

للتحقّق من ختم الحيازة، استخدم `verify --manifest` مع النص الفعلي المقروء من ملف PDF أو الورقة المطبوعة في `--qr-payload`. تعني `VERIFIED_QR_RECORD` أن الصف المختوم وارد في البيان المقدّم. للتحقّق من البايتات، مرّر ملف PDF نفسه. تحمل أنماط QR المخصّصة نصوصها، بينما يضيف ختم الحيازة سجلّ الصف إلى البيان. يعتمد التحقّق من الملف ومن الرمز على البيان غير الموقّع الذي تختاره. يتطلّب إثبات هوية الجهة المصدرة دليلًا منفصلًا. [طريقة حساب البصمات وسجلات QR](pdf-engine.md#custody-manifest)
