# Lessons from Merged Work (ArabiForm)

> Modeled on `yetone/magpie/LESSONS.md`.
> Record real defects, rework patterns, or thin-verification catches after every milestone (`Rule -> Why -> Evidence -> Seen count`). Promote `Seen >= 3` separate days/cycles into [docs/code-standards.md](docs/code-standards.md).

## Active Lessons

### Seeded from M1.5 AcroForm Baseline Probe (2026-11-26)
- **Rule** — Inspect `/XFA` in the raw AcroForm dictionary before invoking `pdfDoc.getForm()`, and treat page `/Rotate` and widget `/MK /R` explicitly.
- **Why** — Calling `getForm()` first silently strips XFA layers on IRS-style hybrid forms; ignoring page rotation or widget rotation produces clipped or rotated glyphs.
- **Evidence** — Verified in `import-medic/docs/research/M1.5/02-evidence/acroform-baseline.cjs` across `irs-w9.pdf`, `irs-1040.pdf`, and `synthetic-rotated.pdf`.
- **Seen: 1** (2026-11-26)

### 清理工作树前确认预览已退出（2026-11-26）

- **规则**　为验收和冒烟预览保留自己的进程或终端会话标识。删除临时目录前核对自己启动的预览已退出。
- **原因**　Windows 上保留的预览会话仍可能占用工作目录。检查合并状态和监听端口无法单独确认目录已释放。
- **证据**　ImportMedic M1 的 `LESSONS.md` 记录了 14 项通过后 Vite 仍在监听，改由测试进程关闭服务后，16 项复跑结束时 43871 端口已关闭。ArabiForm M1 的 [Edge 验收](docs/reports/M1-verification.md#复跑及适用边界) 和工作树清理也遇到预览子进程残留。ArabiForm M2 的 Worker B 在冒烟测试后再次观测到监听 4237 的预览进程（PID 10372）。提交 `b420ac8` 让 Playwright 持有实际产物服务器句柄并在 teardown 关闭。M2 的套件退出及端口复查见[验收报告](docs/reports/M2-verification.md)。
- **Seen: 3**（ImportMedic M1、ArabiForm M1、ArabiForm M2，各计一次，2026-11-26）。已纳入[代码标准](docs/code-standards.md)。

### 合成 PDF 的标题与原有字段也要验字形（2026-11-26）

- **规则**　修改模板字体嵌入或子集策略后，在 PDF.js 和 PyMuPDF 中查看模板标题与保留字段，再验写入字段的值。
- **原因**　首次构建样本时，字体子集丢失了可见拉丁字母。标题和 `KEEP 00109` 字段的值仍可读取。改用完整静态字体后，1.2 倍渲染的两个取样区域分别从 1,270 增到 4,547 个深色像素，从 79 增到 201 个。
- **证据**　M1 样本生成与字体验收见提交 `0487483` 及 [模板说明](fixtures/README.md)。QA 在 [Edge 截图](docs/reports/screenshots/desktop-preview-flagged.png) 复核了完整标题和保留字段。M4 合成模板的阿语静态标题遗漏组合附标的字形偏移，标题靠边的墨迹遭到裁切。提交 `9faff65` 按字形偏移放置两页标题。两页标题裁图均已打开核对，第二页的标题也可在[浏览器截图](docs/reports/screenshots/m4/desktop-m4-choices-ready.png)核对。
- **Seen: 2**（ArabiForm M1、M4，各计一次）

### 用 PDF trailer 判断加密状态（2026-11-26）

- **规则**　在访问页面和表单前检查 trailer 的 `/Encrypt` 及文档加密标志，保留可识别的加密错误码。
- **原因**　锁定版本的 PDF-lib 转译后，使用 `instanceof EncryptedPDFError` 检查会漏认加密错误，用户可能只能看到文件损坏提示。
- **证据**　[入口实现](src/core/pdf/template.ts)、[加密样本](fixtures/golden/encrypted.pdf) 与 [浏览器替换模板测试](tests/e2e/workbench.spec.ts) 覆盖加密拒绝及旧预览失效。
- **Seen: 1**（2026-11-26）

### Excel 文本中的字符实体只解码一次（2026-11-26）

- **规则**　以 CSV 的实际换行为参照，检查 XLSX 富文本与内联字符串的数值实体，保留原文刻意写出的实体字面量。
- **原因**　曾将工作簿里代表换行的 `&#10;` 原样填入 PDF。简单重复解码又会把 `&amp;#10;` 错转为换行。
- **证据**　[富文本回归用例](tests/core/roster.test.ts) 区分两种情况。[双格式下载验收](tests/e2e/downloads.ts) 将每份单页 PDF 的多行 Notes 与 CSV 源文逐字符比较。
- **Seen: 1**（2026-11-26）

### 像素对照使用该次填充时的源字节（2026-11-26）

- **规则**　记录填充时读入的模板，以源文件哈希命名像素对照快照。
- **原因**　并行重新生成 golden 模板时，像素校验可能重新打开已变动的模板，把底图差异误认为填充越界。
- **证据**　[像素校验入口](scripts/verify-pdf-pixels.ts) 在保存输出时冻结同批源字节。[4 倍渲染校验](scripts/verify-pdf-pixels.py) 从清单读取对应快照。
- **Seen: 1**（2026-11-26）

### Seeded from M1 Static Preview & Mobile Overflow Audit (2026-11-26)
- **Rule** — Test direct slashless static route URLs on production preview and measure mobile overflow against the configured viewport (`390px`), keeping wide preview tables inside positioned scroll containers.
- **Why** — Vite preview can fall back to `/` on slashless directory routes, and screen-reader absolute text outside scroll containers silently expands mobile document width past `390px`.
- **Evidence** — Caught and fixed during ImportMedic M1 (`d9c31bc`, `e0f97fd`).
- **Seen: 1** (2026-11-26)

### M2 文本与导出回归（2026-11-26）

Worker A 在实现前记录了下列四项失败。M2 独立验收复跑了对应回归。每项计一个开发周期。[PDF 与导出回归](tests/core/pdf.test.ts) · [固定种子覆盖](tests/core/fuzz.test.ts)

| 规则 | 为什么需要 | 可核证据 | Seen |
|---|---|---|---|
| 混排时同时校验逻辑字段值和外观流里的数字、符号顺序。 | 即使 PDF 的 `/V` 正确，RTL 段中的编号和电话仍可能读反。 | 主执行端回放 `d4c3a3a` 的字形排布，编号片段为 `00123#`，电话为 `345601250966+`。提交 `6be9384` 的字形检查分别得到 `#00123` 和 `+966500123456`，同时保留逻辑原文与空格。 | 1 |
| 把超出 `/MaxLen` 的字符数传到预览和所选行。 | 只有错误码时，用户无法判断需要删几个字符，调小字号也无济于事。 | `000007` 比模板限制多 1 个字符。浏览器另测 10 位文本填入 4 位字段，两处均显示超出 6 个字符，PDF 导出禁用。[界面回归](tests/e2e/m2-batch.spec.ts) | 1 |
| CSV 审计写出时检查兼容字符和前导空白，JSON 保留原文。 | 前导空格与全角加号会绕过只检查首个 ASCII 字符的逻辑。 | 带两个前导空格及全角加号的 `＋1+1.pdf` 在 CSV 单元格加上单引号前缀，JSON 解码后与输入相同。 | 1 |
| 在写 ZIP 时验证每个成员的最终名称。 | 调用方直接传入名称时，可以绕开界面的文件名生成逻辑。 | 旧导出接受 `COM1.txt.pdf`。新导出拒绝保留设备名与归一化重名。浏览器下载的包中，三个会冲突的原始值分别生成 `note.pdf`、`note-2.pdf`、`note-3.pdf`。 | 1 |

### 像素校验入口兼容两类源文件清单（2026-11-26）

- **规则**　更改哈希快照检查时，用核心生成清单与真实浏览器下载清单分别复跑。对按 SHA-256 命名的快照验证文件名与字节，调用方可继续指定独立的源文件名。
- **原因**　M2 核心像素套件已通过，原有浏览器清单使用 `before.pdf`，新加的强制命名断言却让两种视口的 CSV/XLSX 下载验收全部报错。
- **证据**　独立 QA 在集成版本 `b420ac8` 收到 `source snapshot hash changed: before.pdf`。提交 `9722b07` 修正共享校验器后，同一套原有浏览器断言通过。[校验入口](scripts/verify-pdf-pixels.py) · [浏览器清单](tests/e2e/downloads.ts)
- **Seen: 1**（四个失败场景对应同一原因，2026-11-26）

### M3 浏览器文件名与 PDF 外观（2026-11-27）

以下三个缺陷分别计一个里程碑周期。桌面和移动视口复现同一个缺陷，只计一次。[M3 独立验收](docs/reports/M3-verification.md)

| 规则 | 失败证据与修正 | Seen |
|---|---|---|
| 对混排文件名，用浏览器 Range 测量数字前缀、词干和扩展名。移动端发生折行时，每个前缀只与同一行的文字比较。 | M2 文件名逻辑字符串正确，旧 `dir="auto"` 在两个语种和视口的 8 组原布局观测中有 6 组后缀错位。现在队列和所选行共用显式 LTR 容器，阿语词组隔离，`.pdf` 单独固定在右端。[组件](src/web/Filename.tsx) · [Edge 测量](tests/e2e/m3-pro.spec.ts) | 1 |
| 核对交互控件转为打印页面前后的整页像素。可见控件缺少所需外观或其活动状态不明确时，阻止打印导出并保留可编辑导出。 | M3 旧合并页的 3 个复选框各差 66 个像素。修正非整数坐标的外观放置矩阵后，4 倍渲染完全相同。M4 回放发现旧打印路径遇到缺少 `/AP`、`/V` 为数组的下拉框时改变 86,832 个像素，遇到已选中却缺少 `/AS` 的复选框时改变 350 个像素。修正后，两种样本均阻止生成合并 PDF 和压平 ZIP，可编辑 ZIP 的成员字节完整保留。[打印回归](tests/core/choices.test.ts) · [逐页校验](scripts/verify-pdf-pixels.py) · [M4 验收](docs/reports/M4-verification.md) | 2（M3、M4） |
| 验证自定义字体子集时，同时读取嵌入数据、检查渲染器警告并测量实际墨迹。 | Adobe Source Serif 4 的 CFF 子集头曾写出无效的 `offSize=0x0e`。FreeType 回退后仍有墨迹。改为合法值 `0x04` 后，字形像素随之改变，PyMuPDF 渲染无警告。[字体嵌入](src/core/pdf/custom-font.ts) · [CFF 像素案例](scripts/verify-pdf-pixels.ts) | 1 |

### 导出的审计文件保持既有字段契约（2026-11-27）

- **规则**　给预览诊断添加数据时，在审计序列化边界核对 JSON 与 CSV 的既有公开字段，同时验证浏览器下载和预览跳页。
- **原因**　M4 给诊断新增从 1 起算的 `pageNumbers`。导出直接复用内部对象后，旧版的 `too-narrow` 审计记录多出 `pageNumbers: [1]`，违反既有 JSON 和 CSV 下载格式。
- **证据**　在 `05d8a9e`，两种浏览器视口的 CSV、XLSX 上传流程同时在原有下载断言处失败，共 4 项。提交 `9b4a414` 让两种审计输出共用同一序列化边界，预览继续使用页码，选择诊断继续提供合法选项。[审计回归](tests/core/pdf.test.ts) · [原有下载断言](tests/e2e/downloads.ts) · [M4 独立验收](docs/reports/M4-verification.md)
- **Seen: 1**（同一次契约变更，ArabiForm M4）

### Windows 沙箱可能在像素校验启动前拦住 tsx（2026-11-27）

- **规则**　当 `npm run verify:pixels` 在 tsx 创建临时目录时出现 `uv_os_get_passwd ENOMEM`，保留错误日志。在获准的本机环境用相同主线、D 盘输入和临时目录重跑原命令，以新生成的 PyMuPDF 报告判定结果。
- **原因**　tsx 在加载校验脚本前通过 `os.userInfo()` 命名临时目录。此时 PDF 填充、渲染和像素比较均尚未开始。
- **证据**　[M1](docs/reports/M1-verification.md)、[M2](docs/reports/M2-verification.md) 与 [M5](docs/reports/M5-verification.md) 在受限 Windows 环境均记录了相同的系统调用错误。M5 在原主线复跑后完成 26 次填充、87 个有墨迹控件的 4 倍渲染校验。
- **Seen: 6**（M1、M2、M5、M9、M10、M11，各计一次）。[M9 主线](docs/reports/M9-verification.md)、[M10 主线](docs/reports/M10-v1.0-verification.md) 和 [M11 主线](docs/reports/M11-verification.md) 均在 tsx 初始化时复现。M11 用相同提交和 D 盘输入重跑，完成 36 次填充和 120 个有墨迹控件的 4 倍渲染。此项已纳入[代码标准](docs/code-standards.md)。

### 用每个语种的空载网络请求核对首屏分包（2026-11-27）

- **规则**　对英文与阿语入口分别记录选文件前、预检后的浏览器请求，同时核对阿语显示字体是否可用。
- **原因**　M5 首轮的 HTML 只声明了一个 JS 入口，入口也低于大小预算。阿语页面初始化时，界面排版仍通过 JavaScript 加载了 PDF 预检使用的字体数据，产生了 369.04 kB 的额外 gzip 请求。
- **证据**　桌面和移动的五路由空载请求均复现。提交 `493f0ab` 改由本地 CSS 字体服务阿语排版，预检继续读取嵌入数据。[双语请求断言](tests/e2e/m5-rc.spec.ts) · [主线验收](docs/reports/M5-verification.md)
- **Seen: 1**（同一次 M5 验收，两种视口各有一份收据）。

### M6 本机验收的超时与退出码（2026-11-27）

| 规则 | 原因与实测证据 | Seen |
|---|---|---|
| 进程级测试超时后，用同一提交串行复跑，先定位耗时的用例，再调整该用例的预算。 | Worker A 并行执行验收时，校验发布域名的子进程测试超过默认 5 秒。串行复跑通过，提交 `38bc40f` 仅将此项设为 15 秒，保留了伪域名泄漏的全部断言。合并后主线 59 项全部通过。[测试](tests/core/verify-release-bundle.test.ts) | 1（M6） |
| Windows PowerShell 收集原生命令的 stdout 与 stderr 时，命令结束即保存并显式返回 `$LASTEXITCODE`，同时保留测试运行器的状态文件。 | Edge 通过 58 项，运行器保存了 `passed` 和空失败列表。Node 将颜色配置警告写到 stderr，PowerShell 合流后整段命令的退出值为 1。仅让原生退出 0 的 Node 程序写一行 stderr，同样复现了该外壳状态。显式返回保存的原生退出值后为 0。[主线验收](docs/reports/M6-verification.md) | 1（M6） |

### 用浏览器字符坐标验证阿文转换示例（2026-11-27）

- **规则**　在英文界面显示“阿文原字形 → 阿文目标字形”时，为示例设定从左到右的布局，分别隔离两端的阿文。用真实浏览器的 DOM Range 测量每个源字形、箭头和目标字形的同一行位置。
- **证据**　M7 三组示例的逻辑文本均正确。旧桌面截图中，Alef 目标字母的左坐标为 559.30 CSS px，箭头为 565.97，源字形从 583.17 开始。两种视口的方向断言均失败。修复后，三组示例在两种视口都满足每个源字形位于箭头左侧、目标字形位于其右侧。扩展名另用点与单词的左坐标判断先后，保留相邻字符范围的亚像素交叠作为独立量。[真实 Edge 断言](tests/e2e/m7-power-editor.spec.ts) · [M7 验收](docs/reports/M7-verification.md)
- **Seen: 1**（ArabiForm M7 的英文转换示例，三个选项和两种视口合计一次）。

### M8 实际下载、快速完成与容量表（2026-11-27）

| 规则 | 原因与复现证据 | Seen |
|---|---|---|
| 校验水印下面的原文时，从未盖章的同一页取深色墨迹，并独立核对字形、像素差和边界。 | Workshop 正文用深灰墨色，原页红通道的最小值为 25。旧校验器要求至少 11 个纯黑像素，用同一对真实 Edge 下载会误报。修正后，4× 下 68,506 个原有深色像素均未变亮，40,110 个像素呈现印章。[校验器](scripts/verify-pdf-pixels.py) · [真实下载用例](tests/e2e/m8-scale-print-capacity.spec.ts) | 1（M8） |
| 将 PDF 生成推迟到导出时，同时测量真实大批量下载的延迟和每份文件的内容。 | 原有 200 行可编辑 ZIP 在延后渲染后超过 15 s。复用嵌入字体后，桌面一次仍耗时 14.757 s。改为逐份存入最终 ZIP、保留固定大小的归档块后，独立复跑在两个视口均完整读回 200 份，并在原等待预算内收到下载。[字体资源](src/core/pdf/bundled-fonts.ts) · [ZIP 写入](src/core/pdf/exports.ts) · [200 份下载测试](tests/e2e/m2-batch.spec.ts) | 1（M8） |
| 批任务开始时及时显示首次非零进度。检查用户操作跨越完成时的界面，并将需要精确时机的取消测试绑定到实际中间进度。 | 初始 0 占用了 80 ms 显示节流窗口，三个主线用例等到任务完成仍未观察到非零值。跳过零值后 10 次仍有 4 次 React 合并了首个正值与终态。同步提交首个非零中间值后，10 次都在真实结果前读到 25/200。相邻测试的第二次采样和等待按钮稳定后点击又分别遇到正常完成。搜索覆盖 25→200 和 25→25 两种路径。取消测试在有中间进度且按钮可见可用时触发真实处理器，并等待该 Worker 的关闭事件。[界面进度](src/web/useBatch.ts) · [交互断言](tests/e2e/m2-batch.spec.ts) | 1（M8，同一快速预检周期） |
| 给工作台增加列数不同的表格时，将原表的列宽规则限定到该表，并在手机上提示可横向滚动。 | 第一版容量表继承队列表第 4 列的 37% 宽度，一个控件编号占去了大段空白。收紧 CSS 选择器后，桌面 9 列全部可见，390 px 视口可在表格区横滚。[桌面截图](docs/reports/screenshots/m8/desktop-m8-capacity-inspector.png) · [手机截图](docs/reports/screenshots/m8/mobile-m8-capacity.png) | 1（M8） |

### 用实际页面单位和十进制坐标核对 9 pt 临界点（2026-11-27）

- **规则**　先解析 PDF 的 `/UserUnit` 引用，再按可见页框与控件的原始边界换算物理距离。用独立渲染器核对旋转后的方向，同时测量紧邻阈值的两侧和阈值本身。
- **原因**　早期提交 `867ce48` 把间接引用的 2 当作 1，导致物理 8.5 pt 显示为 4.25 pt，本应通过的 9 pt 也触发了警告。另一张 PDF 的横坐标 7.08 与 16.08 相距整 9 pt，二进制浮点直接相减会落入警告范围。
- **证据**　四个旋转方向均与 PyMuPDF 一致。十进制回归保留 8.99999999 pt 的警告，9 pt 和 9.00000001 pt 均通过。[边界及间接引用回归](tests/core/fuzz.test.ts) · [主线验收](docs/reports/M9-verification.md)
- **Seen: 1**（ArabiForm M9 的纸边距离检查，夹具和视口合计一个周期）。

### 用连续的真实按键验证原生对话框（2026-11-27）

- **规则**　从帮助按钮和页面上的第二个焦点位置分别打开对话框。用 Tab 和 Shift+Tab 跨越首尾，按 Escape 关闭后立即再次按打开快捷键，并验证退出时焦点回到各自的打开位置。
- **原因**　M10 初版能打开且能退出，但向前越过最后一个控件时焦点离开页面。补上首尾循环后，主线仍在 80 次快速重开中漏掉 62 次。Edge 已经关闭原生窗口并恢复焦点，稍后送达的 close 事件才让页面更新弹窗状态。
- **证据**　同步更新关闭状态后，同一批 80 次操作全部成功。[双视口连续按键回归](tests/e2e/m10-keyboard.spec.ts) · [M10 独立验收](docs/reports/M10-v1.0-verification.md)
- **Seen: 1**（M10 帮助对话框，按同一个开发周期计）。

### 测控件对比度时合成透明色（2026-11-27）

- **规则**　用浏览器实际绘制的前景、控件底色和相邻底色计算相对亮度。有透明度时逐层合成，并核对键盘焦点轮廓与实际原生控件的可见像素。
- **原因**　M10 的首次搜索框测量把透明底色的 RGB 分量当作黑底，得到约 20.80∶1。还原实际底色后，旧边框仅为 1.4589∶1。调整边框后同处达到 3.9535∶1。
- **证据**　[Edge 文字、边界与焦点测量](tests/e2e/m10-accessibility.ts) · [原生控件像素](tests/e2e/m10-native-contrast.py) · [M10 独立验收](docs/reports/M10-v1.0-verification.md)
- **Seen: 1**（M10 首次全路由对比度验收）。

### 激活 PDF 预览控件后仍要看清字段开头（2026-11-27）

- **规则**　在真实浏览器中对同一字段保留选中与未选中两幅图，比较靠近边框的字形笔画。选中或键盘焦点的描边放在控件边界外。
- **原因**　M11 的选中标记向控件内侧画了一圈白边。导出的 PDF 完整保留了 `CERT-0001`，画布中的首字母 C 却被遮住。桌面比较检出 7 个消失的笔画像素，手机检出 4 个。
- **证据**　提交 `20c5a6b` 把描边移到外侧。复跑在 1440 px 和 390 px 视口分别检查 86、43 个墨迹采样点，两边遮挡均为 0。[浏览器操作](tests/e2e/m11-canvas-virtual.spec.ts) · [实绘像素比较](tests/e2e/m11-overlay-ink.py) · [修复后画布](docs/reports/screenshots/m11/desktop-m11-virtual-serial.png)
- **Seen: 1**（M11 预览选中态，两种视口合计一个开发周期）。
