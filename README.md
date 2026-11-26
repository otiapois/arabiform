# ArabiForm

ArabiForm fills text fields, checkboxes, dropdowns, and radio groups in interactive AcroForm PDFs from a CSV or Excel (`.xlsx`) roster. Map columns, preview Arabic and mixed-script text, and correct flagged rows in your browser before export. [اقرأ بالعربية](#العربية)

1. Choose an AcroForm PDF with supported editable fields and a roster. **Try Synthetic Arabic Sample** opens Workshop Attendance, which has a deliberately overlong entry. The **Synthetic sample workflows** gallery loads Workshop Attendance, Clinic Consent, Multi-Page HR Choices, or Landscape Visitor Badge when you select it. All four use fictional data.
2. Match roster columns under **Field mapping**. Use **Leave unchanged** to keep a field as it is. For checkboxes, use `true`/`false`, `yes`/`no`, `1`/`0`, `x`/an empty cell, or `نعم`/`لا`. Checkbox values are trimmed, and English letter case is ignored. For a dropdown or radio group, copy a label shown in the mapping panel or the PDF's export value when it differs. ArabiForm checks for a unique exact match first, then a unique match after trimming surrounding whitespace. Keep the original Unicode characters, diacritics, and letter case.
3. Search the preflight queue by row number, filename, or cell value. Filter for ready rows, flagged rows, or source warnings. Selecting a flagged row opens its first affected page. Use **Fit**, **100%**, **125%**, or **150%** and select a page number to jump to that page. A red dot marks each page with flagged fields. A value with no match or an ambiguous match flags the row and shows the template's choices. In the row editor, choose a valid option. For a text-length or fit issue, edit the cell or apply the suggested minimum size when offered, then check the preview again.
4. Download the ready rows as separate editable PDFs in a ZIP by default, or as one flattened PDF in row order for printing. Turn on **Flatten individual PDFs in ZIP (lock fields for print/mobile sharing)** in **Output settings** to make one flattened copy per row instead. Editable copies keep unmapped values and appearances. The flattened copies carry the visible field appearances into the page and remove interactive form controls. Download the preflight diagnostics separately as CSV or JSON.

The queue shows the final filenames used in the ZIP and preflight audit. Open **Filename adjusted** for the reason when a name was cleaned up, changed because Windows reserves it, or given a number to avoid a duplicate. Changing the filename pattern updates the queue immediately. Press `/` outside form fields to focus queue search. Press `Esc` in an open row editor to restore the values from before that edit and return to **Edit row**.

To edit roster text in bulk, open **Clean & replace roster text** and select one or more columns. The preview shows the exact number of changed rows and cells and up to five before-and-after examples. Space cleanup is selected by default in the panel and only takes effect when you apply it. It trims and collapses whitespace, replaces non-breaking spaces with ordinary spaces, and removes U+200B and U+FEFF while keeping the Arabic joining controls ZWJ and ZWNJ. Turn on each letter or diacritic change separately. The options convert `أ/إ/آ` to `ا`, `ة` to `ه`, or `ى` to `ي`, or remove Arabic diacritics in U+064B–U+065F and U+0670. Find and replace matches literal text after the selected cleanup, with case matching enabled by default. An empty replacement deletes matches. **Undo last transform** restores the values from before the latest application, including earlier edits and leading zeros such as `00123`. Use it before making a new manual cell edit.

Use **Align** on a mapped text field to select **Auto**, **Right (RTL)**, **Left (LTR)**, or **Center**. Auto keeps the default placement. Right and Left place the rendered text at the chosen edge, and Center uses the actual width of its ink. Arabic and mixed-script shaping remain active with every setting.

The Landscape Visitor Badge sample demonstrates the batch font-size suggestion. When preflight finds rows that can pass by lowering the minimum size, the button shows how many rows can benefit. Applying it rechecks the full batch. Review any flags that remain before export.

For a print index, turn on **Include printable cover sheet in Merged PDF** under **Output settings**, then download the merged printable PDF. The cover is off by default. It uses the current English or Arabic interface language and shows the local export date, template filename, and minimum font size and font mode from the batch preflight. **Ready** counts the rows included in the file, **Flagged** counts the rows needing review, and **Skipped** counts the rows left out. Rows still flagged at export are also counted as skipped. The index lists each printed row's queue number, final filename, and actual page range. Page numbers include all cover pages, even when the index spans several pages.

Print-locked refers to removing the interactive form controls. The resulting files are ordinary PDFs and can still be modified with PDF-editing tools. If a visible field lacks a usable saved appearance, use the editable ZIP or a template with saved appearances. Before sending or printing a batch, open a test copy in the actual viewer or sharing app and check the Arabic text, selections, and page order. PDF.js and PyMuPDF checks cover specific files and display paths. A handoff through iOS, macOS Preview, WhatsApp, or a printer needs its own check.

Keep IDs such as `00123` stored as text. Check the source warnings for numeric Excel cells that may already have lost digits or leading zeros. For a mapped formula cell, ArabiForm uses the result cached in the workbook, or a blank value if the cache is missing. Review the warning and recalculate the workbook or replace the formula with a verified value before printing.

Under **Output settings**, keep the bundled Noto fonts or choose a local file with **Custom font (.ttf / .otf)**. The workbench flags fields whose text needs glyphs missing from the selected font. Review the actual PDF preview for each new template and font. **Clear** switches back to the bundled font setting. Font bytes stay in the current tab during processing and can be embedded in the PDFs you generate.

Export a local JSON mapping preset to reuse field-to-column mappings, the filename pattern, the minimum font size, the bundled font setting, and the output options. If you choose a text alignment other than Auto, the preset saves as version 4. With every field on Auto, a batch with a cover saves as version 3. With the cover off, an editable ZIP saves as version 1 and a flattened ZIP as version 2. Versions 1–3 still import and use Auto alignment. Versions 1 and 2 import with the cover off. Presets contain settings only. After importing, select a custom font again if you need one.

Use **Save Draft (.json)** to keep inline edits, changes from roster cleanup, cleanup summaries, field mapping, and output settings in a local file. To reopen the draft, select the same PDF and roster files, the same worksheet for Excel, and the same custom font file if used. Then choose **Load Draft (.json)**. ArabiForm checks that the file contents match and reports a mismatch before applying any draft changes. The draft can contain roster cell values. It is stored as the JSON file you save, without a cloud copy or a copy in browser storage.

The workbench displays mixed-script filenames such as `00001-ليلى حسن.pdf` with `.pdf` at the right edge in both interface languages. In the Arabic **Source files** card, the roster hint displays `.xlsx` with the dot on the left. The workbench rejects XFA, signed or encrypted PDFs, and flat or scanned PDFs without supported interactive fields. Files, previews, and exports are processed locally on your device. A local Web Worker reports batch progress and stops the active job when you cancel.

On `/arabic-pdf-form-filler` and `/ar/pdf-mail-merge`, compare a clipped baseline with placement based on the visible boundaries of the letters and marks in the synthetic specimen `بَنِي يَمَن / سَلْمَى بِنْت يَاسِين`. Check your own text in the PDF preview.

See the workbench with synthetic data on [desktop](docs/reports/screenshots/m3/desktop-m3-mixed-widgets.png) and [mobile](docs/reports/screenshots/m3/mobile-m3-mixed.png), the [custom-font controls](docs/reports/screenshots/m3/desktop-m3-custom-font.png), and the [synthetic demo walkthrough](docs/launch/demo-walkthrough.md).

## Run and verify locally

CI uses Node.js 24, Python 3.13, and `PyMuPDF==1.26.7`. From the repository root, install dependencies and run the CI checks.

```sh
npm ci --ignore-scripts
python -m pip install PyMuPDF==1.26.7
npm run typecheck
npm test
npm run test:fuzz
npm run verify:pixels
npm run build
npm run verify:release
```

The committed synthetic PDFs, CSV, and workbook support offline testing after install. Run `npm run generate:fixtures -- --check` to compare the generated fixture bytes against the tracked copies. See the [fixture guide](fixtures/README.md) for cases and optional public blank-template checks.

For a local run, use `npm run dev`. Use `npm run preview` after a build to serve the production headers at `http://127.0.0.1:4173`. Run `npm run test:e2e` with Microsoft Edge installed. The Edge suite is separate from the CI checks above and uses the installed browser.

The seeded fuzz tests exercise roster parsing, checkbox and choice inputs, font handling, filenames, mixed-direction text, and AcroForm exports. The 4× PyMuPDF checks compare filled fixtures with source templates and compare flattened exports with their editable renders. Results apply to the tested files and readers. Inspect the preview and a test export with your own template, font, and PDF viewer before printing a batch. [M4 verification report](docs/reports/M4-verification.md)

For Windows development, keep the checkout, worktrees, dependencies, and Python environment on `D:`. Direct npm and pip caches to `D:\cache\arabiform\npm` and `D:\cache\arabiform\pip` with their `--cache` and `--cache-dir` flags. Point the local session’s `TEMP` and `TMP` to an existing `D:` directory. If you need a Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`.

## Static build

`npm run build` writes five static routes to `dist/` along with local assets, a sitemap, `robots.txt`, Cloudflare Pages `_headers`, and license notices.

- `/`
- `/arabic-pdf-form-filler`
- `/ar/pdf-mail-merge`
- `/preserve-leading-zeros-pdf`
- `/privacy-and-proof`

Set `SITE_URL` to the actual site's origin before a release build. Run `npm run verify:release -- --strict-origin` with the same `SITE_URL` to reject any leftover `https://arabiform.example` placeholder. Serve the files from the origin root with the response headers in `_headers`. The privacy and worker directives are `connect-src 'none'; worker-src 'self'; form-action 'none'`.

See the [Cloudflare Pages checklist](docs/launch/cloudflare-and-7day-plan.md), [project instructions](AGENTS.md), [subsystems](docs/subsystems/README.md), [code standards](docs/code-standards.md), [lessons](LESSONS.md), [M4 brief](docs/tasks/M4-dropdowns-radios-print-pack.md), [M5 release candidate brief](docs/tasks/M5-rc-a11y-bundle-and-5k-fuzz.md), [M6 brief](docs/tasks/M6-cover-sheet-and-visual-proof.md), and [M7 brief](docs/tasks/M7-power-editor-arabic-normalize.md). [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## العربية

تملأ أداة ArabiForm الحقول النصية وخانات الاختيار والقوائم المنسدلة ومجموعات أزرار الاختيار في نماذج PDF التفاعلية من جدول CSV أو Excel (`.xlsx`). اربط الأعمدة بالحقول وعاين النص العربي والنص المختلط، ثم صحّح الصفوف التي تحتاج إلى مراجعة قبل التصدير. تتم المعالجة داخل متصفحك.

1. اختر نموذج AcroForm فيه حقول مدعومة قابلة للتعديل، ثم اختر جدول البيانات. يفتح زر «جرّب العينة العربية الاصطناعية» نموذج حضور ورشة العمل، وفيه اسم طويل عمدًا لتجربة تعديله. يتيح معرض العينات فتح حضور ورشة العمل أو موافقة العيادة أو خيارات الموارد البشرية متعددة الصفحات أو بطاقة زائر أفقية. تستخدم العينات الأربع بيانات خيالية.
2. اربط الأعمدة بالحقول، وحدّد «أبقِ المحتوى الأصلي» للحقول التي تريد الإبقاء عليها. تقبل خانات الاختيار `true` أو `false`، و`yes` أو `no`، و`1` أو `0`، و`x` أو خلية فارغة، و«نعم» أو «لا». وتتجاهل المسافات في بداية القيمة ونهايتها وحالة الأحرف الإنجليزية. للقوائم المنسدلة وأزرار الاختيار، انسخ اسم الخيار المعروض في لوحة الربط أو قيمة التصدير المعرّفة له في PDF إذا اختلفت. تبحث الأداة أولًا عن تطابق حرفي مع خيار واحد، ثم تعيد المحاولة بعد تجاهل المسافات في بداية القيمة ونهايتها. احتفظ بالحروف وعلامات التشكيل وحالة الأحرف كما تظهر في الخيار.
3. ابحث في قائمة الفحص المسبق برقم الصف أو اسم الملف أو محتوى الخلية. صفِّ النتائج بحسب الجاهزية أو الحاجة إلى المراجعة أو تنبيهات المصدر. يفتح اختيار صف يحتاج إلى مراجعة أول صفحة فيها مشكلة. اختر ملاءمة الصفحة للمساحة المتاحة أو العرض بنسبة 100٪ أو 125٪ أو 150٪، واضغط على رقم الصفحة للانتقال إليها. تشير النقطة الحمراء إلى صفحة فيها حقل يحتاج إلى مراجعة. إذا لم تطابق القيمة أي خيار أو طابقت أكثر من خيار، تظهر خيارات النموذج لتختار قيمة صالحة من محرّر الصف. إذا تجاوز النص مساحة الحقل أو عدد الأحرف المسموح به، عدّل الخلية أو طبّق الحد الأدنى المقترح لحجم الخط عند ظهوره، ثم راجع المعاينة من جديد.
4. نزّل الصفوف الجاهزة كملفات PDF منفصلة قابلة للتعديل في أرشيف ZIP، أو كملف PDF واحد للطباعة بترتيب الصفوف. من **إعدادات الإخراج**، فعّل «تسطيح ملفات PDF الفردية داخل ZIP» لتثبيت مظهر الحقول في نسخة منفصلة لكل صف. تحتفظ النسخ القابلة للتعديل بقيم الحقول غير المرتبطة ومظهرها الأصلي. عند التسطيح يصبح المظهر المرئي للحقول جزءًا من الصفحة وتزول عناصر النموذج التفاعلية. يمكنك تنزيل تقرير الفحص بصيغة CSV أو JSON.

تعرض قائمة الفحص أسماء الملفات النهائية المستخدمة في أرشيف ZIP وتقرير الفحص. افتح «تم تعديل اسم الملف» لمعرفة السبب، سواء نُقّح الاسم أو تغيّر لأنه محجوز في Windows أو أُضيف إليه رقم لتفادي التكرار. يؤدي تغيير نمط تسمية الملفات إلى تحديث القائمة فورًا. اضغط `/` خارج حقول النموذج للانتقال إلى البحث. اضغط `Esc` داخل محرّر الصف لاستعادة القيم التي كانت موجودة قبل فتحه والعودة إلى زر «عدّل الصف».

لتعديل نصوص الجدول دفعة واحدة، افتح لوحة «نظّف واستبدل نصوص الجدول» وحدّد عمودًا أو أكثر. تعرض المعاينة العدد الدقيق للصفوف والخلايا التي ستتغيّر، وما يصل إلى خمسة أمثلة قبل التعديل وبعده. يكون خيار تنظيف المسافات محدّدًا في اللوحة، ويبدأ أثره عند التطبيق. يزيل هذا الخيار المسافات في أول النص وآخره، ويدمج المسافات المتتالية، ويحوّل المسافات غير القابلة للكسر إلى مسافات عادية. ويحذف المحرفين U+200B وU+FEFF مع الإبقاء على محرفَي الوصل والفصل ZWJ وZWNJ. ويمكنك تفعيل كل تغيير على حدة لتحويل `أ/إ/آ` إلى `ا`، أو `ة` إلى `ه`، أو `ى` إلى `ي`، أو لحذف علامات التشكيل في النطاق U+064B–U+065F والمحرف U+0670. يبحث خيار البحث والاستبدال عن النص حرفيًا بعد تطبيق خيارات التنظيف المحدّدة، ويراعي حالة الأحرف افتراضيًا. اترك نص الاستبدال فارغًا لحذف المطابقات. يعيد زر «تراجع عن آخر تعديل جماعي» القيم التي كانت موجودة قبل تطبيقه، بما فيها التعديلات السابقة والأصفار في أول المعرّفات مثل `00123`. استخدمه قبل إجراء تعديل يدوي جديد على خلية.

في الحقول النصية المرتبطة، اضبط المحاذاة تلقائيًا أو إلى اليمين أو اليسار أو الوسط. يبقي الخيار التلقائي موضع النص الافتراضي. تضع المحاذاة إلى اليمين أو اليسار النص عند الطرف المحدّد، ويعتمد التوسيط على العرض الفعلي للحروف وعلاماتها. تُشكَّل الحروف العربية ويُرتّب النص المختلط في جميع الخيارات.

تتيح عينة بطاقة الزائر الأفقية تجربة اقتراح حجم الخط للدفعة. إذا أمكن لبعض الصفوف اجتياز الفحص بخفض الحد الأدنى لحجم الخط، يعرض الزر عددها. عند تطبيق الاقتراح يُعاد فحص الدفعة كاملة. راجع التنبيهات المتبقية قبل التصدير.

لإضافة فهرس للطباعة، فعّل «أدرج صفحة غلاف قابلة للطباعة في ملف PDF المدمج» من **إعدادات الإخراج**، ثم نزّل ملف PDF المدمج. يكون خيار الغلاف متوقفًا افتراضيًا. يظهر الغلاف بلغة الواجهة، العربية أو الإنجليزية، ويعرض تاريخ التصدير المحلي واسم ملف القالب والحد الأدنى لحجم الخط ووضع الخط المستخدَمَين في الفحص. يشير «جاهز» إلى عدد الصفوف المدرجة في الملف، و«يحتاج إلى مراجعة» إلى عدد الصفوف التي رصد فيها الفحص مشكلة، و«تم تخطيه» إلى عدد الصفوف المستبعدة. كل صف ما زال يحتاج إلى مراجعة عند التصدير يُحسب أيضًا ضمن الصفوف المستبعدة. لكل صف مدرج في الملف، يبيّن الفهرس رقمه في قائمة الفحص واسم ملفه النهائي ونطاق صفحاته الفعلي. يشمل الترقيم جميع صفحات الغلاف إذا امتدّ الفهرس إلى أكثر من صفحة.

قفل الحقول للطباعة يعني إزالة عناصر النموذج التفاعلية. تبقى الملفات بصيغة PDF عادية ويمكن تعديلها بأدوات تحرير PDF. إذا تعذّر التسطيح لأن أحد الحقول المرئية يفتقر إلى مظهر محفوظ صالح، نزّل ملفات ZIP القابلة للتعديل أو استخدم قالبًا يحتوي على مظاهر محفوظة لحقوله. افتح نسخة تجريبية في برنامج العرض أو المشاركة الذي ستستخدمه، وتحقّق من النص العربي والخيارات وترتيب الصفحات قبل إرسال الدفعة أو طباعتها. تغطّي اختبارات PDF.js وPyMuPDF ملفات ومسارات عرض محددة. اختبر النتيجة بنفسك إذا كنت ستستخدم iOS أو تطبيق «المعاينة» في macOS أو واتساب أو طابعة.

احفظ المعرّفات مثل `00123` كنص. راجع تنبيهات المصدر إذا حوّل Excel أحد المعرّفات إلى رقم قد تكون أصفاره الأولى أو بعض خاناته ضاعت. عندما ترتبط خلية تحتوي على صيغة بأحد الحقول، تستخدم الأداة آخر نتيجة حفظها Excel في الملف، أو تترك القيمة فارغة إذا لم تُحفَظ فيه نتيجة. راجع التنبيه وأعد حساب الجدول أو استبدل الصيغة بقيمة تحققت منها قبل الطباعة.

من **إعدادات الإخراج**، يمكنك استخدام خطوط نوتو المضمّنة أو اختيار ملف خط محلي بصيغة `.ttf` أو `.otf`. يعرض الفحص تنبيهًا إذا احتاج الحقل إلى حروف أو علامات يفتقر إليها الخط. عاين ملف PDF مع كل قالب وخط جديد. عند مسح اختيار الخط المخصّص، تعود الأداة إلى إعداد الخط المضمّن. تبقى بيانات الخط في علامة التبويب الحالية أثناء المعالجة، وقد يُضمَّن الخط في ملفات PDF التي تنشئها.

احفظ الربط بين الحقول والأعمدة ونمط تسمية الملفات والحد الأدنى لحجم الخط وإعداد الخط المضمّن وخيارات الإخراج في ملف JSON محلي. إذا حدّدت محاذاة غير تلقائية لأي حقل نصي، تُحفَظ إعدادات الربط بالإصدار 4. إذا بقيت كل المحاذاة تلقائية، يُستخدَم الإصدار 3 عند تفعيل الغلاف. وعند إيقاف الغلاف يُستخدَم الإصدار 1 لملفات ZIP القابلة للتعديل والإصدار 2 لملفات ZIP المسطّحة. تستمر الأداة في استيراد الإصدارات 1 إلى 3 بالمحاذاة التلقائية، ويكون الغلاف متوقفًا عند استيراد الإصدار 1 أو 2. يحتوي الملف على الإعدادات فقط. بعد استيراده، أعد اختيار ملف الخط المخصّص عند الحاجة.

استخدم زر حفظ المسودة بصيغة `.json` للاحتفاظ بتعديلات الخلايا وتغييرات التنظيف وملخّصها وإعدادات الربط والإخراج. لاستعادة المسودة، اختر ملف PDF وجدول البيانات نفسيهما، وورقة العمل نفسها إذا كان الجدول بصيغة Excel، وملف الخط المخصّص نفسه إذا سبق أن استخدمته. ثم اضغط زر تحميل المسودة. تتحقّق الأداة من تطابق محتوى الملفات وتعرض تنبيهًا عند الاختلاف قبل تطبيق أي تغييرات من المسودة. قد تحتوي المسودة على قيم من خلايا الجدول. تُحفظ في ملف JSON الذي تنزّله، دون نسخ إلى السحابة أو إلى مساحة تخزين المتصفح.

في الواجهتين العربية والإنجليزية، يظهر الامتداد `.pdf` عند الطرف الأيمن من أسماء الملفات المختلطة مثل `00001-ليلى حسن.pdf`. وفي بطاقة ملفات المصدر بالعربية تظهر نقطة امتداد `.xlsx` على يسار الأحرف في تلميح اختيار الجدول. ترفض الأداة نماذج XFA والملفات الموقّعة أو المشفّرة وملفات PDF المسطّحة أو الممسوحة ضوئيًا التي تخلو من الحقول التفاعلية المدعومة. تبقى ملفاتك على جهازك أثناء المعالجة والمعاينة والتصدير. تعرض مهمة محلية في المتصفح (Web Worker) تقدّم الدفعة، وتتوقّف الدفعة الجارية عند إلغائها.

في دليلَي تعبئة PDF على `/ar/pdf-mail-merge` و`/arabic-pdf-form-filler` يمكنك التبديل بين عرض تُقصّ فيه أجزاء من الحروف وعرض يضبط موضعها بحسب حدود الحروف وعلامات التشكيل في المثال الاصطناعي `بَنِي يَمَن / سَلْمَى بِنْت يَاسِين`. تحقّق من نصّك في معاينة PDF.

راجع [واجهة العمل بالعربية مع عينة اصطناعية](docs/reports/screenshots/m3/desktop-m3-ar-rtl-filenames.png) و[سيناريو العرض بالعربية والإنجليزية](docs/launch/demo-walkthrough.md).

بعد تثبيت الحزم، يمكن تنفيذ الاختبارات بالملفات الاصطناعية المرفقة دون اتصال بالإنترنت. يختبر `npm run test:fuzz` حالات مولّدة يمكن تكرارها، منها قراءة الجداول وقيم خانات الاختيار والقوائم المنسدلة وأزرار الاختيار والخطوط وأسماء الملفات واتجاه النص والتصدير. يقارن PyMuPDF النماذج المملوءة بالقوالب الأصلية ويقارن النسخ المسطّحة بالنسخ القابلة للتعديل بتكبير 4 أضعاف. تغطّي النتائج الملفات وبرامج العرض المستخدمة في الاختبارات. راجع المعاينة وملفًا تجريبيًا بقالبك وخطك وبرنامج عرض PDF الذي تستخدمه قبل طباعة الدفعة.

استخدم أوامر التحقق أعلاه مع Node.js 24 وPython 3.13. لمعاينة النسخة المبنية مع ترويسات الأمان، شغّل `npm run preview` بعد البناء. يتطلب `npm run test:e2e` تثبيت Microsoft Edge. على Windows، احتفظ بملفات العمل والملفات المؤقتة وذاكرات التخزين المؤقت على القرص `D:`. تُحفَظ صفحات الموقع الثابتة الخمس في `dist/`، وتُضبَط قيمة `SITE_URL` على عنوان الموقع الفعلي عند تجهيز نسخة للنشر.
