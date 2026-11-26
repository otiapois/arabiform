# ArabiForm

ArabiForm fills text fields, checkboxes, dropdowns, and radio groups in interactive AcroForm PDFs from a CSV or Excel (`.xlsx`) roster. Map columns, preview Arabic and mixed-script text, and correct flagged rows in your browser before export. [اقرأ بالعربية](#العربية)

1. Choose an AcroForm PDF with supported editable fields and a roster. **Try Synthetic Arabic Sample** loads a fictional roster with a deliberately overlong entry you can fix in the workbench.
2. Match roster columns under **Field mapping**. Use **Leave unchanged** to keep a field as it is. For checkboxes, use `true`/`false`, `yes`/`no`, `1`/`0`, `x`/an empty cell, or `نعم`/`لا`. Checkbox values are trimmed, and English letter case is ignored. For a dropdown or radio group, copy a label shown in the mapping panel or the PDF's export value when it differs. ArabiForm checks for a unique exact match first, then a unique match after trimming surrounding whitespace. Keep the original Unicode characters, diacritics, and letter case.
3. Search the preflight queue by row number, filename, or cell value. Filter for ready rows, flagged rows, or source warnings. Selecting a flagged row opens the first affected page. Use the **Page N** buttons in the preview to inspect the other affected pages. A value with no match or an ambiguous match flags the row and shows the template's choices. In the row editor, choose a valid option. For a text-length or fit issue, edit the cell or apply the suggested minimum size when offered, then check the preview again.
4. Download the ready rows as separate editable PDFs in a ZIP by default, or as one flattened PDF in row order for printing. Turn on **Flatten individual PDFs in ZIP (lock fields for print/mobile sharing)** in **Output settings** to make one flattened copy per row instead. Editable copies keep unmapped values and appearances. The flattened copies carry the visible field appearances into the page and remove interactive form controls. Download the preflight diagnostics separately as CSV or JSON.

The queue shows the final filenames used in the ZIP and preflight audit. Open **Filename adjusted** for the reason when a name was cleaned up, changed because Windows reserves it, or given a number to avoid a duplicate. Changing the filename pattern updates the queue immediately. Press `/` outside form fields to focus queue search. Press `Esc` in an open row editor to restore the values from before that edit and return to **Edit row**.

Print-locked refers to removing the interactive form controls. The resulting files are ordinary PDFs and can still be modified with PDF-editing tools. If a visible field lacks a usable saved appearance, use the editable ZIP or a template with saved appearances. Before sending or printing a batch, open a test copy in the actual viewer or sharing app and check the Arabic text, selections, and page order. PDF.js and PyMuPDF checks cover specific files and display paths. A handoff through iOS, macOS Preview, WhatsApp, or a printer needs its own check.

Keep IDs such as `00123` stored as text. Check the source warnings for numeric Excel cells that may already have lost digits or leading zeros. For a mapped formula cell, ArabiForm uses the result cached in the workbook, or a blank value if the cache is missing. Review the warning and recalculate the workbook or replace the formula with a verified value before printing.

Under **Output settings**, keep the bundled Noto fonts or choose a local file with **Custom font (.ttf / .otf)**. The workbench flags fields whose text needs glyphs missing from the selected font. Review the actual PDF preview for each new template and font. **Clear** switches back to the bundled font setting. Font bytes stay in the current tab during processing and can be embedded in the PDFs you generate.

Export a local JSON mapping preset to reuse field-to-column mappings, the filename pattern, the minimum font size, the bundled font setting, and the ZIP setting. Presets with editable ZIP use version 1. A preset saved with flattened ZIP enabled uses version 2. Older version 1 presets still import and set ZIP output to editable. Presets contain settings only. After importing, select a custom font again if you need one.

The workbench displays mixed-script filenames such as `00001-ليلى حسن.pdf` with `.pdf` at the right edge in both interface languages. It rejects XFA, signed or encrypted PDFs, and flat or scanned PDFs without supported interactive fields. Files, previews, and exports are processed locally on your device. A local Web Worker reports batch progress and stops the active job when you cancel.

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

Set `SITE_URL` to the actual site's origin before a release build. `https://arabiform.example` is the local placeholder. Serve the files from the origin root with the response headers in `_headers`. The privacy and worker directives are `connect-src 'none'; worker-src 'self'; form-action 'none'`.

See the [Cloudflare Pages checklist](docs/launch/cloudflare-and-7day-plan.md), [project instructions](AGENTS.md), [subsystems](docs/subsystems/README.md), [code standards](docs/code-standards.md), [lessons](LESSONS.md), [M4 brief](docs/tasks/M4-dropdowns-radios-print-pack.md), and [M5 release candidate brief](docs/tasks/M5-rc-a11y-bundle-and-5k-fuzz.md). [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## العربية

تملأ أداة ArabiForm الحقول النصية وخانات الاختيار والقوائم المنسدلة ومجموعات أزرار الاختيار في نماذج PDF التفاعلية من جدول CSV أو Excel (`.xlsx`). اربط الأعمدة بالحقول وعاين النص العربي والنص المختلط، ثم صحّح الصفوف التي تحتاج إلى مراجعة قبل التصدير. تتم المعالجة داخل متصفحك.

1. اختر نموذج AcroForm فيه حقول مدعومة قابلة للتعديل، ثم اختر جدول البيانات. تتضمن العينة الاصطناعية بيانات خيالية واسمًا طويلًا عمدًا لتجربة تعديله.
2. اربط الأعمدة بالحقول، وحدّد «أبقِ المحتوى الأصلي» للحقول التي تريد الإبقاء عليها. تقبل خانات الاختيار `true` أو `false`، و`yes` أو `no`، و`1` أو `0`، و`x` أو خلية فارغة، و«نعم» أو «لا». وتتجاهل المسافات في بداية القيمة ونهايتها وحالة الأحرف الإنجليزية. للقوائم المنسدلة وأزرار الاختيار، انسخ اسم الخيار المعروض في لوحة الربط أو قيمة التصدير المعرّفة له في PDF إذا اختلفت. تبحث الأداة أولًا عن تطابق حرفي مع خيار واحد، ثم تعيد المحاولة بعد تجاهل المسافات في بداية القيمة ونهايتها. احتفظ بالحروف وعلامات التشكيل وحالة الأحرف كما تظهر في الخيار.
3. ابحث في قائمة الفحص المسبق برقم الصف أو اسم الملف أو محتوى الخلية. صفِّ النتائج بحسب الجاهزية أو الحاجة إلى المراجعة أو تنبيهات المصدر. يفتح اختيار صف يحتاج إلى مراجعة أول صفحة فيها مشكلة. استخدم أزرار الصفحات في المعاينة للانتقال إلى الصفحات الأخرى المتأثرة. إذا لم تطابق القيمة أي خيار أو طابقت أكثر من خيار، تظهر خيارات النموذج لتختار قيمة صالحة من محرّر الصف. إذا تجاوز النص مساحة الحقل أو عدد الأحرف المسموح به، عدّل الخلية أو طبّق الحد الأدنى المقترح لحجم الخط عند ظهوره، ثم راجع المعاينة من جديد.
4. نزّل الصفوف الجاهزة كملفات PDF منفصلة قابلة للتعديل في أرشيف ZIP، أو كملف PDF واحد للطباعة بترتيب الصفوف. من **إعدادات الإخراج**، فعّل «تسطيح ملفات PDF الفردية داخل ZIP» لتثبيت مظهر الحقول في نسخة منفصلة لكل صف. تحتفظ النسخ القابلة للتعديل بقيم الحقول غير المرتبطة ومظهرها الأصلي. عند التسطيح يصبح المظهر المرئي للحقول جزءًا من الصفحة وتزول عناصر النموذج التفاعلية. يمكنك تنزيل تقرير الفحص بصيغة CSV أو JSON.

تعرض قائمة الفحص أسماء الملفات النهائية المستخدمة في أرشيف ZIP وتقرير الفحص. افتح «تم تعديل اسم الملف» لمعرفة السبب، سواء نُقّح الاسم أو تغيّر لأنه محجوز في Windows أو أُضيف إليه رقم لتفادي التكرار. يؤدي تغيير نمط تسمية الملفات إلى تحديث القائمة فورًا. اضغط `/` خارج حقول النموذج للانتقال إلى البحث. اضغط `Esc` داخل محرّر الصف لاستعادة القيم التي كانت موجودة قبل فتحه والعودة إلى زر «عدّل الصف».

قفل الحقول للطباعة يعني إزالة عناصر النموذج التفاعلية. تبقى الملفات بصيغة PDF عادية ويمكن تعديلها بأدوات تحرير PDF. إذا تعذّر التسطيح لأن أحد الحقول المرئية يفتقر إلى مظهر محفوظ صالح، نزّل ملفات ZIP القابلة للتعديل أو استخدم قالبًا يحتوي على مظاهر محفوظة لحقوله. افتح نسخة تجريبية في برنامج العرض أو المشاركة الذي ستستخدمه، وتحقّق من النص العربي والخيارات وترتيب الصفحات قبل إرسال الدفعة أو طباعتها. تغطّي اختبارات PDF.js وPyMuPDF ملفات ومسارات عرض محددة. اختبر النتيجة بنفسك إذا كنت ستستخدم iOS أو تطبيق «المعاينة» في macOS أو واتساب أو طابعة.

احفظ المعرّفات مثل `00123` كنص. راجع تنبيهات المصدر إذا حوّل Excel أحد المعرّفات إلى رقم قد تكون أصفاره الأولى أو بعض خاناته ضاعت. عندما ترتبط خلية تحتوي على صيغة بأحد الحقول، تستخدم الأداة آخر نتيجة حفظها Excel في الملف، أو تترك القيمة فارغة إذا لم تُحفَظ فيه نتيجة. راجع التنبيه وأعد حساب الجدول أو استبدل الصيغة بقيمة تحققت منها قبل الطباعة.

من **إعدادات الإخراج**، يمكنك استخدام خطوط نوتو المضمّنة أو اختيار ملف خط محلي بصيغة `.ttf` أو `.otf`. يعرض الفحص تنبيهًا إذا احتاج الحقل إلى حروف أو علامات يفتقر إليها الخط. عاين ملف PDF مع كل قالب وخط جديد. عند مسح اختيار الخط المخصّص، تعود الأداة إلى إعداد الخط المضمّن. تبقى بيانات الخط في علامة التبويب الحالية أثناء المعالجة، وقد يُضمَّن الخط في ملفات PDF التي تنشئها.

احفظ الربط بين الحقول والأعمدة ونمط تسمية الملفات والحد الأدنى لحجم الخط وإعداد الخط المضمّن وإعداد إخراج ZIP في ملف JSON محلي. يستخدم الإخراج القابل للتعديل الإصدار 1، ويُحفَظ الملف بالإصدار 2 عند تفعيل التسطيح داخل ZIP. يمكن استيراد ملفات الإعدادات القديمة من الإصدار 1، وعندها تكون ملفات ZIP قابلة للتعديل. يحتوي الملف على الإعدادات فقط. بعد استيراده، أعد اختيار ملف الخط المخصّص عند الحاجة.

في الواجهتين العربية والإنجليزية، يظهر الامتداد `.pdf` عند الطرف الأيمن من أسماء الملفات المختلطة مثل `00001-ليلى حسن.pdf`. ترفض الأداة نماذج XFA والملفات الموقّعة أو المشفّرة وملفات PDF المسطّحة أو الممسوحة ضوئيًا التي تخلو من الحقول التفاعلية المدعومة. تبقى ملفاتك على جهازك أثناء المعالجة والمعاينة والتصدير. تعرض مهمة محلية في المتصفح (Web Worker) تقدّم الدفعة، وتتوقّف الدفعة الجارية عند إلغائها.

راجع [واجهة العمل بالعربية مع عينة اصطناعية](docs/reports/screenshots/m3/desktop-m3-ar-rtl-filenames.png) و[سيناريو العرض بالعربية والإنجليزية](docs/launch/demo-walkthrough.md).

بعد تثبيت الحزم، يمكن تنفيذ الاختبارات بالملفات الاصطناعية المرفقة دون اتصال بالإنترنت. يختبر `npm run test:fuzz` حالات مولّدة يمكن تكرارها، منها قراءة الجداول وقيم خانات الاختيار والقوائم المنسدلة وأزرار الاختيار والخطوط وأسماء الملفات واتجاه النص والتصدير. يقارن PyMuPDF النماذج المملوءة بالقوالب الأصلية ويقارن النسخ المسطّحة بالنسخ القابلة للتعديل بتكبير 4 أضعاف. تغطّي النتائج الملفات وبرامج العرض المستخدمة في الاختبارات. راجع المعاينة وملفًا تجريبيًا بقالبك وخطك وبرنامج عرض PDF الذي تستخدمه قبل طباعة الدفعة.

استخدم أوامر التحقق أعلاه مع Node.js 24 وPython 3.13. لمعاينة النسخة المبنية مع ترويسات الأمان، شغّل `npm run preview` بعد البناء. يتطلب `npm run test:e2e` تثبيت Microsoft Edge. على Windows، احتفظ بملفات العمل والملفات المؤقتة وذاكرات التخزين المؤقت على القرص `D:`. تُحفَظ صفحات الموقع الثابتة الخمس في `dist/`، وتُضبَط قيمة `SITE_URL` على عنوان الموقع الفعلي عند تجهيز نسخة للنشر.
