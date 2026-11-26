# ArabiForm

ArabiForm fills text fields and checkboxes in interactive AcroForm PDFs from a CSV or Excel (`.xlsx`) roster. Map columns, preview Arabic and mixed-script text, and correct flagged rows in your browser before export. [اقرأ بالعربية](#العربية)

1. Choose an AcroForm PDF with editable text fields or checkboxes and a roster. **Try Synthetic Arabic Sample** loads a fictional roster with a deliberately overlong entry you can fix in the workbench.
2. Map columns to text fields and checkboxes. For checkboxes, use `true`/`false`, `yes`/`no`, `1`/`0`, `x`/an empty cell, or `نعم`/`لا`. Leading and trailing spaces are ignored, and letter case is ignored for English values. Unrecognized values flag the row for review.
3. Search the preflight queue by row number, filename, or cell value. Filter for ready rows, flagged rows, or source warnings. Select a flagged row to see which field needs review, the largest font size that fits when available, or how many characters exceed the field limit. Edit the cell or apply the suggested minimum size when the workbench offers one, then check the preview again.
4. Export the rows that pass as editable PDFs in a ZIP or as one flattened PDF for printing. In the editable copies, unmapped fields keep their original values and appearances, including checkboxes, radio buttons, and dropdowns. The flattened file preserves their visible appearance. Download the preflight diagnostics separately as CSV or JSON.

Keep IDs such as `00123` stored as text. Check the source warnings for numeric Excel cells that may already have lost digits or leading zeros. For a mapped formula cell, ArabiForm uses the result cached in the workbook, or a blank value if the cache is missing. Review the warning and recalculate the workbook or replace the formula with a verified value before printing.

Under **Output settings**, keep the bundled Noto fonts or choose a local file with **Custom font (.ttf / .otf)**. The workbench flags fields whose text needs glyphs missing from the selected font. Review the actual PDF preview for each new template and font. **Clear** switches back to the bundled font setting. Font bytes stay in the current tab during processing and can be embedded in the PDFs you generate.

Export a version 1 JSON mapping preset to reuse text and checkbox mappings, the filename pattern, the minimum font size, and the bundled font setting. The preset contains settings only. Importing it restores its bundled font setting. Select a custom font again if you need one.

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

The seeded fuzz tests exercise roster parsing, checkbox inputs, font handling, filenames, mixed-direction text, and AcroForm filling. The 4× PyMuPDF checks compare rendered fixtures with their source templates. Results apply to the tested files and readers. Inspect the preview and a test export with your own template, font, and PDF viewer before printing a batch. [M2 verification report](docs/reports/M2-verification.md)

For Windows development, keep the checkout, worktrees, dependencies, and Python environment on `D:`. Direct npm and pip caches to `D:\cache\arabiform\npm` and `D:\cache\arabiform\pip` with their `--cache` and `--cache-dir` flags. Point the local session’s `TEMP` and `TMP` to an existing `D:` directory. If you need a Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`.

## Static build

`npm run build` writes five static routes to `dist/` along with local assets, a sitemap, `robots.txt`, Cloudflare Pages `_headers`, and license notices.

- `/`
- `/arabic-pdf-form-filler`
- `/ar/pdf-mail-merge`
- `/preserve-leading-zeros-pdf`
- `/privacy-and-proof`

Set `SITE_URL` to the actual site's origin before a release build. `https://arabiform.example` is the local placeholder. Serve the files from the origin root with the response headers in `_headers`. The privacy and worker directives are `connect-src 'none'; worker-src 'self'; form-action 'none'`.

See the [Cloudflare Pages checklist](docs/launch/cloudflare-and-7day-plan.md), [project instructions](AGENTS.md), [subsystems](docs/subsystems/README.md), [code standards](docs/code-standards.md), [lessons](LESSONS.md), and [M3 brief](docs/tasks/M3-arabiform-pro-features.md). [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## العربية

تملأ أداة ArabiForm الحقول النصية وخانات الاختيار في نماذج PDF التفاعلية من جدول CSV أو Excel (`.xlsx`). اربط الأعمدة بالحقول وعاين النص العربي والنص المختلط، ثم صحّح الصفوف التي تحتاج إلى مراجعة قبل التصدير. تتم المعالجة داخل متصفحك.

1. اختر نموذج AcroForm فيه حقول نصية أو خانات اختيار قابلة للتعديل، ثم اختر جدول البيانات. تتضمن العينة الاصطناعية بيانات خيالية واسمًا طويلًا عمدًا لتجربة تعديله.
2. اربط الأعمدة بالحقول النصية وخانات الاختيار. تقبل خانة الاختيار `true` أو `false`، و`yes` أو `no`، و`1` أو `0`، و`x` أو خلية فارغة، و«نعم» أو «لا». تتجاهل الأداة المسافات في بداية القيمة ونهايتها وحالة الأحرف الإنجليزية. تظهر علامة مراجعة بجانب الصف عند إدخال قيمة غير معروفة.
3. ابحث في قائمة الفحص المسبق برقم الصف أو اسم الملف أو محتوى الخلية. صفِّ النتائج بحسب الجاهزية أو الحاجة إلى المراجعة أو تنبيهات المصدر. اختر صفًا يحتاج إلى مراجعة لتعرف أي حقل يحتاج إلى تعديل، وأكبر حجم خط يتّسع له الحقل إن أمكن، أو عدد الأحرف الزائدة. عدّل الخلية أو طبّق الحد الأدنى المقترح لحجم الخط عند ظهوره، ثم راجع المعاينة من جديد.
4. نزّل الصفوف التي اجتازت الفحص كملفات PDF قابلة للتعديل في أرشيف ZIP، أو كملف PDF واحد للطباعة تتحول فيه الحقول إلى جزء ثابت من الصفحة. تحتفظ النسخ القابلة للتعديل بقيم الحقول غير المرتبطة ومظهرها الأصلي، ومنها خانات الاختيار وأزرار الاختيار والقوائم المنسدلة. يحتفظ ملف الطباعة بمظهرها المرئي. يمكنك تنزيل تقرير الفحص بصيغة CSV أو JSON.

احفظ المعرّفات مثل `00123` كنص. راجع تنبيهات المصدر إذا حوّل Excel أحد المعرّفات إلى رقم قد تكون أصفاره الأولى أو بعض خاناته ضاعت. عندما ترتبط خلية تحتوي على صيغة بأحد الحقول، تستخدم الأداة آخر نتيجة حفظها Excel في الملف، أو تترك القيمة فارغة إذا لم تُحفَظ فيه نتيجة. راجع التنبيه وأعد حساب الجدول أو استبدل الصيغة بقيمة تحققت منها قبل الطباعة.

من **إعدادات الإخراج**، يمكنك استخدام خطوط نوتو المضمّنة أو اختيار ملف خط محلي بصيغة `.ttf` أو `.otf`. يعرض الفحص تنبيهًا إذا احتاج الحقل إلى حروف أو علامات يفتقر إليها الخط. عاين ملف PDF مع كل قالب وخط جديد. عند مسح اختيار الخط المخصّص، تعود الأداة إلى إعداد الخط المضمّن. تبقى بيانات الخط في علامة التبويب الحالية أثناء المعالجة، وقد يُضمَّن الخط في ملفات PDF التي تنشئها.

احفظ ربط الأعمدة بالحقول النصية وخانات الاختيار ونمط تسمية الملفات والحد الأدنى لحجم الخط وإعداد الخط المضمّن في ملف JSON بالإصدار 1. يحتوي الملف على الإعدادات فقط. عند استيراده، تستخدم الأداة إعداد الخط المضمّن الذي يحفظه. أعد اختيار ملف الخط المخصّص عند الحاجة.

في الواجهتين العربية والإنجليزية، يظهر الامتداد `.pdf` عند الطرف الأيمن من أسماء الملفات المختلطة مثل `00001-ليلى حسن.pdf`. ترفض الأداة نماذج XFA والملفات الموقّعة أو المشفّرة وملفات PDF المسطّحة أو الممسوحة ضوئيًا التي تخلو من الحقول التفاعلية المدعومة. تبقى ملفاتك على جهازك أثناء المعالجة والمعاينة والتصدير. تعرض مهمة محلية في المتصفح (Web Worker) تقدّم الدفعة، وتتوقّف الدفعة الجارية عند إلغائها.

راجع [واجهة العمل بالعربية مع عينة اصطناعية](docs/reports/screenshots/m3/desktop-m3-ar-rtl-filenames.png) و[سيناريو العرض بالعربية والإنجليزية](docs/launch/demo-walkthrough.md).

بعد تثبيت الحزم، يمكن تنفيذ الاختبارات بالملفات الاصطناعية المرفقة دون اتصال بالإنترنت. يختبر `npm run test:fuzz` حالات مولّدة يمكن تكرارها، منها قراءة الجداول وتعبئة خانات الاختيار والخطوط وأسماء الملفات واتجاه النص. يقارن PyMuPDF صور النماذج قبل التعبئة وبعدها بتكبير 4 أضعاف. تغطّي النتائج الملفات وبرامج العرض المستخدمة في الاختبارات. راجع المعاينة وملفًا تجريبيًا بقالبك وخطك وبرنامج عرض PDF الذي تستخدمه قبل طباعة الدفعة.

استخدم أوامر التحقق أعلاه مع Node.js 24 وPython 3.13. لمعاينة النسخة المبنية مع ترويسات الأمان، شغّل `npm run preview` بعد البناء. يتطلب `npm run test:e2e` تثبيت Microsoft Edge. على Windows، احتفظ بملفات العمل والملفات المؤقتة وذاكرات التخزين المؤقت على القرص `D:`. تُحفَظ صفحات الموقع الثابتة الخمس في `dist/`، وتُضبَط قيمة `SITE_URL` على عنوان الموقع الفعلي عند تجهيز نسخة للنشر.
