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
- M15 的设计器打开真实 PDF 后，390 px 视口的页面宽度增到 715 px。允许画布所在网格列收缩后，英阿两种界面在设计、恢复布局和填表阶段均保持 390 px。检查页面宽度时要先载入内容。[实测溢出](test-results/m15-evidence/implementation-checks/mobile-overflow-before.log) · [双语触屏回归](tests/e2e/m15-designer.spec.ts)
- M21 初版把结果表的最小宽度设为 36rem，诊断列占 49%。在 390 px 的 RTL 页面载入结果后，表格初始可见区域内的两条就绪文件名都只露出结尾，第三行的原因在可视范围外。提交 `961302f` 把手机版的每人结果分行显示。填入三行样本后，英阿结果容器的客户区宽度与滚动宽度均为 338 px，文件名和诊断完整可见。首轮截图在复跑时被替换，现存图片展示修复后的界面。[Edge 尺寸与文字位置](test-results/m21-evidence/worker-b/runtime.json) · [手机截图](docs/reports/screenshots/m21/mobile-m21-packet.png)
- **Seen: 3**（ImportMedic M1、ArabiForm M15、M21 各一次）。在真实内容载入后核对移动页面和关键内容的可见宽度，已纳入[代码标准](docs/code-standards.md)。

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
| 在 RTL 正文中用显式 LTR 方向隔离拉丁扩展名和随附的括号。用浏览器 Range 核对同一行的点、字母和括号的实绘顺序。对于混排文件名，同时检查编号、词干与扩展名。 | M3 的 8 组原布局中有 6 组 PDF 文件名后缀错位。M7 将来源卡的 `.xlsx` 放入 LTR 隔离元素，并在两种视口测得点位于字母左侧。M16 的 390 px 阿语按钮曾把 `(.zip)` 画成 `(zip.)`。修复前点的横坐标为 142.609 px，位于 p 的 134.031 px 右侧。修复后点为 122.109 px，z 为 125.844 px。M17 的既有扩展名方向正确。手机上的阿语句点与 `_Ungrouped` 的下划线原本共用 286.641 px 的边界。把句点移回说明句末，并在文件夹名称前加上阿语标签后，两者分开。新增桌面与手机 Range 回归同时覆盖拆分 ZIP、交接清单与草稿按钮。已纳入[代码标准](docs/code-standards.md)。[M3 文件名](tests/e2e/m3-pro.spec.ts) · [M7 来源卡](docs/reports/M7-verification.md) · [M16 修复前](test-results/m16-evidence/worker-b/split-extension-before.json) · [M16 修复后](test-results/m16-evidence/worker-b/split-extension-after.json) · [M17 实测](tests/e2e/m17-studio-verifier.spec.ts) | 4（M3、M7、M16、M17） |
| 核对交互控件转为打印页面前后的整页像素。可见控件缺少所需外观或其活动状态不明确时，阻止打印导出并保留可编辑导出。 | M3 旧合并页的 3 个复选框各差 66 个像素。修正非整数坐标的外观放置矩阵后，4 倍渲染完全相同。M4 回放发现旧打印路径遇到缺少 `/AP`、`/V` 为数组的下拉框时改变 86,832 个像素，遇到已选中却缺少 `/AS` 的复选框时改变 350 个像素。修正后，两种样本均阻止生成合并 PDF 和压平 ZIP，可编辑 ZIP 的成员字节完整保留。M17 的 HR 模板在压平时改变了 `StartDate` 区域的 901 个像素。修正控件的非整数坐标并保留原始外观后，四类模板的可编辑页与压平页 4 倍渲染完全一致，加码后仅码区内有变化。已纳入[代码标准](docs/code-standards.md)。[打印回归](tests/core/choices.test.ts) · [逐页校验](scripts/verify-pdf-pixels.py) · [M4 验收](docs/reports/M4-verification.md) · [M17 修复前](test-results/m17-evidence/worker-a/starter-flatten-parity-red.json) · [M17 修复后](test-results/m17-evidence/lead-studio-final/flatten-isolation.json) | 3（M3、M4、M17） |
| 验证自定义字体子集时，同时读取嵌入数据、检查渲染器警告并测量实际墨迹。 | Adobe Source Serif 4 的 CFF 子集头曾写出无效的 `offSize=0x0e`。FreeType 回退后仍有墨迹。改为合法值 `0x04` 后，字形像素随之改变，PyMuPDF 渲染无警告。[字体嵌入](src/core/pdf/custom-font.ts) · [CFF 像素案例](scripts/verify-pdf-pixels.ts) | 1 |

### 导出的审计文件保持既有字段契约（2026-11-27）

- **规则**　给预览诊断添加数据时，在审计序列化边界核对 JSON 与 CSV 的既有公开字段，同时验证浏览器下载和预览跳页。
- **原因**　M4 给诊断新增从 1 起算的 `pageNumbers`。导出直接复用内部对象后，旧版的 `too-narrow` 审计记录多出 `pageNumbers: [1]`，违反既有 JSON 和 CSV 下载格式。
- **证据**　在 `05d8a9e`，两种浏览器视口的 CSV、XLSX 上传流程同时在原有下载断言处失败，共 4 项。提交 `9b4a414` 让两种审计输出共用同一序列化边界，预览继续使用页码，选择诊断继续提供合法选项。[审计回归](tests/core/pdf.test.ts) · [原有下载断言](tests/e2e/downloads.ts) · [M4 独立验收](docs/reports/M4-verification.md)
- **Seen: 1**（同一次契约变更，ArabiForm M4）

### Windows 沙箱可能在像素校验启动前拦住 tsx（2026-11-27）

- **规则**　当 `npm run verify:pixels` 在 tsx 创建临时目录时出现 `uv_os_get_passwd ENOMEM`，保留错误日志。在获准的本机环境用相同主线、D 盘输入和临时目录重跑原命令，以新生成的 PyMuPDF 报告判定结果。
- **原因**　tsx 在加载校验脚本前通过 `os.userInfo()` 命名临时目录。此时 PDF 填充、渲染和像素比较均尚未开始。
- M21 的像素入口和 CLI 首次都停在同一系统调用。获准使用同一提交和 D 盘输入后，原生运行完成 69 项像素对照，四个 CLI 场景分别返回 0、2、2、2。本周期计一次。[首次启动](test-results/m21-evidence/qa-pixels.log) · [本机像素结果](test-results/m21-evidence/qa-pixels-native.log) · [CLI 输出](test-results/m21-evidence/qa-cli/receipt-native.json)
- **证据**　[M1](docs/reports/M1-verification.md)、[M2](docs/reports/M2-verification.md) 与 [M5](docs/reports/M5-verification.md) 在受限 Windows 环境均记录了相同的系统调用错误。M5 在原主线复跑后完成 26 次填充、87 个有墨迹控件的 4 倍渲染校验。
- M22 的像素入口和 CLI 均在项目代码运行前收到相同错误。冻结主线用相同 D 盘输入复跑，PyMuPDF 完成 66 次填充、213 个带墨迹控件的四倍检查；浏览器与独立 CLI 输出的两份 PDF 逐字节相同。[启动日志](test-results/m22-evidence/qa-pixels.log) · [四倍渲染](test-results/m22-evidence/qa-pixels-native.log) · [CLI 读回](test-results/m22-evidence/qa-cli/readback.json)
- M26 的专项 CLI 在运行应用代码前收到同一错误，正式主线以本机 Node 和 D 盘临时目录重跑，严格阻断、预检、修复填充分别返回 2、2、0。[沙箱首轮](test-results/m26-evidence/qa-focused/sandbox-cli.log) · [冻结主线 CLI](test-results/m26-evidence/qa-main/cli-native/receipt.json)
- M27 首次冻结提交 `493424f`的 CLI 和像素校验均在 tsx 初始化时退出。使用同一提交、输入和 D 盘临时目录，本机重跑完成七次 CLI、91 份表单四倍对照和一页英阿重印摘要。本周期计一次。[CLI 启动日志](test-results/m27-evidence/qa-main/sandbox-cli/clean.stderr) · [像素启动日志](test-results/m27-evidence/qa-main/sandbox-pixels/pixels.log) · [CLI 回执](test-results/m27-evidence/qa-main/first-493424f/cli-native/receipt.json) · [像素回执](test-results/m27-evidence/qa-main/first-493424f/pixels-manifest-verification.json)
- **Seen: 19**（M1、M2、M5、M9、M10、M11、M12、M13、M14、M15、M16、M17、M18、M19、M20、M21、M22、M26、M27，各计一次）。M20 的像素与 CLI 首次运行都在同一系统调用处退出。D 盘原输入在获准的本机环境完成 67 组像素对照和 v10 的三类 CLI 场景，本次合计一次。[M20 启动错误](test-results/m20-evidence/qa-pixels.log) · [M20 像素复跑](test-results/m20-evidence/qa-pixels-native.log) · [M20 CLI 复跑](test-results/m20-evidence/cli-native-summary.json)。M19 冻结主线同样在 tsx 初始化处退出，原命令在相同提交和 D 盘输入下完成 65 次填充。[M19 启动错误](test-results/m19-evidence/qa-pixels.log) · [M19 本机复跑](test-results/m19-evidence/qa-pixels-native.log)。M18 的像素检查和 CLI 首次运行在同一处停止，沿用冻结提交及 D 盘输入复验通过。[像素启动错误](test-results/m18-evidence/qa-pixels.log) · [原命令复验](test-results/m18-evidence/qa-pixels-native.log) · [CLI 启动错误](test-results/m18-evidence/qa-cli-9aeeb15-local/studio.stderr)。M17 冻结主线在同一调用处失败，保留了[首次日志](test-results/m17-evidence/qa-pixels.log)和[原命令的本机记录](test-results/m17-evidence/qa-pixels-native.log)。M16 冻结主线的相同启动错误及同版本重跑分别保存在[沙箱日志](test-results/m16-evidence/qa-pixels.log)和[本机日志](test-results/m16-evidence/qa-pixels-native.log)。[M9 主线](docs/reports/M9-verification.md)、[M10 主线](docs/reports/M10-v1.0-verification.md) 和 [M11 主线](docs/reports/M11-verification.md) 均在 tsx 初始化时复现。M11 用相同提交和 D 盘输入重跑，完成 36 次填充和 120 个有墨迹控件的 4 倍渲染。[M12](docs/reports/M12-verification.md) 复跑完成 38 次填充、128 个有墨迹控件和 8 张 QR 盖章页。[M13](docs/reports/M13-verification.md) 在同一提交复跑，完成 44 次填充、140 个有墨迹控件及 4 张 A4 合版页。M14 同样在进入像素校验前收到 `uv_os_get_passwd ENOMEM`。[M14 启动错误](test-results/m14-evidence/qa-pixels.log)。M15 在冻结主线上复现，使用同一提交及 D 盘输入重跑原命令。[M15 启动错误](test-results/m15-evidence/qa-pixels.log) · [原命令重跑](test-results/m15-evidence/qa-pixels-native.log)。此项已纳入[代码标准](docs/code-standards.md)。

### 用每个语种的空载网络请求核对首屏分包（2026-11-27）

- **规则**　对英文与阿语入口分别记录选文件前、预检后的浏览器请求，同时核对阿语显示字体是否可用。
- **原因**　M5 首轮的 HTML 只声明了一个 JS 入口，入口也低于大小预算。阿语页面初始化时，界面排版仍通过 JavaScript 加载了 PDF 预检使用的字体数据，产生了 369.04 kB 的额外 gzip 请求。
- **证据**　桌面和移动的五路由空载请求均复现。提交 `493f0ab` 改由本地 CSS 字体服务阿语排版，预检继续读取嵌入数据。[双语请求断言](tests/e2e/m5-rc.spec.ts) · [主线验收](docs/reports/M5-verification.md)
- M27 首屏仍只加载入口脚本。真正打开提取工具或 CLI 帮助时，桌面英阿用例各多加载一个中间模块。修复后继续用原断言区分首屏、打开工具、运行示例三个时段，并逐段核对脚本请求。[首次桌面回执](test-results/m27-evidence/qa-main/first-493424f/desktop-discovery.log) · [修复后专项](test-results/m27-evidence/worker-web/m27-lazy-regression-edge-final.log)
- **Seen: 2**（M5 首屏、M27 打开工具时各计一次）。

### M6 本机验收的超时与退出码（2026-11-27）

| 规则 | 原因与实测证据 | Seen |
|---|---|---|
| 保留测试超时的首轮日志，按用例复跑并核对实际耗时。保留原有输入、用例数及断言，按测量结果调整确实耗时的单项。 | M6 并行验收时，严格来源的子进程检查超过默认 5 秒，提交 `38bc40f` 为该项设置 15 秒。M11 再次记录该检查实际耗时 22.248 秒，串行主线复跑全部 100 项通过。M18 首轮 50 例 PDF 字节比对和 150 例验真超过各自的 60 秒和 5 秒，改为逐字节比较并给这两项 180 秒和 30 秒后，冻结主线的 55 项种子测试全部通过。已纳入[代码标准](docs/code-standards.md)。[M6](docs/reports/M6-verification.md) · [M11 超时](test-results/m11-evidence/core-test-full-native.log) · [M11 全套](test-results/m11-evidence/qa-main-unit.log) · [M18 首轮](test-results/m18-evidence/worker-a/fuzz-and-regressions.log) · [M18 冻结复验](test-results/m18-evidence/qa-fuzz.log) | 3（M6、M11、M18，各计一次） |
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
- M23 比较两版控件时，横坐标从 0.10–92.11 平移到 32.18–124.19，两版按 `/UserUnit 1.25` 换算后的宽度都是 115.0125 pt。保留十进制精度后，平移得到零项尺寸变化。把新版右边界改为 124.1899999，同一用例检出真实的 −0.000000125 pt 收窄。[尺寸差分回归](tests/core/template-diff.test.ts)
- **Seen: 2**（M9 纸边距离、M23 模板尺寸比较，各计一个周期）。

### 用连续的真实按键验证原生对话框（2026-11-27）

- **规则**　从帮助按钮和页面上的第二个焦点位置分别打开对话框。用 Tab 和 Shift+Tab 跨越首尾，按 Escape 关闭后立即再次按打开快捷键，并验证退出时焦点回到各自的打开位置。
- **原因**　M10 初版能打开且能退出，但向前越过最后一个控件时焦点离开页面。补上首尾循环后，主线仍在 80 次快速重开中漏掉 62 次。Edge 已经关闭原生窗口并恢复焦点，稍后送达的 close 事件才让页面更新弹窗状态。
- **证据**　同步更新关闭状态后，同一批 80 次操作全部成功。[双视口连续按键回归](tests/e2e/m10-keyboard.spec.ts) · [M10 独立验收](docs/reports/M10-v1.0-verification.md)
- **Seen: 1**（M10 帮助对话框，按同一个开发周期计）。

### 测控件对比度时合成透明色（2026-11-27）

- **规则**　用浏览器实际绘制的前景、控件底色和相邻底色计算相对亮度。有透明度时逐层合成，并核对键盘焦点轮廓与实际原生控件的可见像素。
- **原因**　M10 的首次搜索框测量把透明底色的 RGB 分量当作黑底，得到约 20.80∶1。还原实际底色后，旧边框仅为 1.4589∶1。调整边框后同处达到 3.9535∶1。
- **证据**　[Edge 文字、边界与焦点测量](tests/e2e/m10-accessibility.ts) · [原生控件像素](tests/e2e/m10-native-contrast.py) · [M10 独立验收](docs/reports/M10-v1.0-verification.md)
- M14 的新模式按钮文字通过了检查，未选中按钮的透明边界与外侧背景却只有 1∶1。两个语言和两个视口均在真实 Edge 复现。为未选中按钮指定已有的控件边框色后，原判定通过。[失败收据](test-results/m14-evidence/qa-focused-fixed.log) · [修复后测量](test-results/m14-evidence/qa-focused-final-summary.json)
- **Seen: 2**（M10、M14，各计一次）。

### 激活 PDF 预览控件后仍要看清字段开头（2026-11-27）

- **规则**　在真实浏览器中对同一字段保留选中与未选中两幅图，比较靠近边框的字形笔画。选中或键盘焦点的描边放在控件边界外。
- **原因**　M11 的选中标记向控件内侧画了一圈白边。导出的 PDF 完整保留了 `CERT-0001`，画布中的首字母 C 却被遮住。桌面比较检出 7 个消失的笔画像素，手机检出 4 个。
- **证据**　提交 `20c5a6b` 把描边移到外侧。复跑在 1440 px 和 390 px 视口分别检查 86、43 个墨迹采样点，两边遮挡均为 0。[浏览器操作](tests/e2e/m11-canvas-virtual.spec.ts) · [实绘像素比较](tests/e2e/m11-overlay-ink.py) · [修复后画布](docs/reports/screenshots/m11/desktop-m11-virtual-serial.png)
- **Seen: 1**（M11 预览选中态，两种视口合计一个开发周期）。

### 样本加载器与样本数据使用可区分的分包名（2026-11-27）

- **规则**　给样本加载器命名时，把 `sample-` 前缀保留给具体的样本数据包。用生产构建的浏览器请求确认每次选择只加载对应的数据包。
- **原因**　M12 将示例选择逻辑拆为按需加载模块，生成的 `sample-workflows-*.js` 与实际样本包都命中了图库原有的 `sample-` 请求检查。四个图库场景都在一次选择后计到两个包。
- **证据**　提交 `ddf41f2` 调整加载器名称后，保留原断言，在桌面和手机分别验证四个示例，均只观察到一个对应的样本数据包。[图库用例](tests/e2e/m6-workflows.spec.ts) · [M12 验收](docs/reports/M12-verification.md)
- **Seen: 1**（M12 分包重命名，两种视口合计一次）。

### 在收起的原生选择框里核对整条选项（2026-11-27）

- **规则**　在目标视口选中最长选项，按实际字体测量文本宽度，扣除选择框内边距和原生箭头占用的空间，再查看收起状态的截图。
- **原因**　M13 的英文两条记录拼版选项末尾被截断。页面宽度、选项 DOM 文本和无障碍名称当时均通过检查。
- **证据**　提交 `efd19e1` 调整拼版选择框的排版。Edge 桌面以 18 px 预留箭头后有 278.32 px 可用，完整英文选项实测 258.84 px。[浏览器回归](tests/e2e/m13-workbook-print.spec.ts) · [实际截图](docs/reports/screenshots/m13/desktop-m13-xlsx-sheet-and-2up.png)
- **Seen: 1**（M13 原生拼版选项，英阿语和两种视口合计一个周期）。

### 为结果面板与可滚动表格分别命名（2026-11-27）

- **规则**　如果结果面板和其中可聚焦的滚动表格都声明为区域，在浏览器无障碍树中检查两个区域名称，并在英阿界面分别读取。
- **原因**　M14 提取结果原先将面板标题同时赋给内层滚动区域。两种语言下都读到 5 个区域、4 个不同名称。新增滚动区域的双语名称后，原有地标检查通过。
- **证据**　[首次 Edge 失败记录](test-results/m14-evidence/qa-focused.log) · [双语提取器回归](tests/e2e/m14-extractor.spec.ts)
- **Seen: 1**（M14，两个语言和两个视口合计一次）。

### 保留工作台锚点与进度控件的包含关系（2026-11-27）

- **规则**　新增模式切换时，让既有 `#workbench` 跳转目标包含两个模式的实际内容，并用原有批任务进度和取消用例复跑。
- **原因**　M14 把这个 ID 移到模式按钮组，队列成了它的兄弟节点。首轮主线验收中 200 行已就绪，绑定在工作台内的观察器却收不到进度变化，两个原有场景相继超时。[首轮主线日志](test-results/m14-evidence/qa-edge-before-workbench.log) · [原有进度用例](tests/e2e/m2-batch.spec.ts)
- **Seen: 1**（M14，两个受影响的场景计一次）。

### 按分组后的文件名搜索和显示队列（2026-11-27）

- **规则**　以该行在 ZIP 中的实际文件名驱动队列、重名提醒、搜索与所选行摘要。用两个分组中的同名文件，以及同一分组中的第二个同名文件，逐个对照下载结果。
- **原因与证据**　M16 开发版将另一个分组里的首份 `same-label.pdf` 显示为 `same-label-2.pdf`，并提示重名。修复后两个分组都能保留原名，同组重名才带上后缀。独立 Edge 用后缀名搜索，只命中原始第 3 行，所选行摘要、审计和 ZIP 内路径与这条记录一致。[首次失败](test-results/m16-evidence/worker-b/grouped-preview-red.log) · [浏览器回归](tests/e2e/m16-grouped-designer.spec.ts)
- **Seen: 1**（M16，同一处分组命名变化计一次）。

### 逐像素对照英阿界面的同一份 PDF 预览（2026-11-27）

- 在两种界面用相同模板和设置生成 PDF，比较相同尺寸画布的 RGBA，并打开两张截图检查字形。M17 中，PDF.js 画布继承了阿语界面的 RTL 方向，英文标题中的字母错位。两边画布均有墨迹，下载文件的 4 倍实绘也通过了检查。
- 将 PDF 绘图画布设为 LTR 后，两种界面在桌面和手机上都得到相同的 760 × 538 像素画面。前后两轮分别保存了画布哈希和截图。[失败截图](test-results/m17-evidence/qa-rtl-preview-red/desktop-m17-template-studio-ar.png) · [修复后的截图](docs/reports/screenshots/m17/desktop-m17-template-studio-ar.png) · [浏览器断言](tests/e2e/m17-studio-verifier.spec.ts)
- **Seen: 1**（M17，两种视口复现同一处画布方向错误）。

### 同步独立发布测试包的预渲染输入（2026-11-28）

- **规则**　预渲染器新增文件输入时，把该文件列入隔离测试包。用原有断言分别验证默认来源、入口大小和严格来源。
- **证据**　M18 将工作台翻译移入本地 JSON 后，开发工作树能够完整构建，独立测试包仍遗漏这份文件。首次冻结主线的 3 项发布检查都在预渲染处退出。补入单条文件路径后，隔离检查 3/3 通过，最终主线单元测试 185/185 通过。[隔离复现](test-results/m18-evidence/worker-b/release-fixture-red.log) · [修复后](test-results/m18-evidence/worker-b/release-fixture-green.log) · [主线验收](docs/reports/M18-verification.md)
- **Seen: 1**（M18，同一份输入引起三个用例失败，计一次）。

### 从稳定的工作台节点记录短暂的预检阶段（2026-11-28）

M8 的真实预检能在两次浏览器采样之间完成。测试改为上传名单前监听工作台中的进度控件，记录首个非零中间值，再独立核对完成状态。M14 调整模式切换时将队列移出了监听范围，已有 200 条就绪记录，原用例仍超时。M19 首次把观察器绑在带来源版本 key 的 `.queue` 上，上传名单时整个队列被替换，两种语言、两个视口的四个场景均收不到阶段文案。把 key 下移到 ActiveQueue 后，外层队列贯穿上传过程，测试保存实际 live 区域的文案，再核对 5 条就绪、0 条标记。[M8 观察器](tests/e2e/m2-batch.spec.ts) · [M14 首次失败](test-results/m14-evidence/qa-edge-before-workbench.log) · [M19 首次失败](test-results/m19-evidence/worker-b/m5-e2e.log) · [M19 修复后](test-results/m19-evidence/worker-b/final-m5-e2e.log)

**Seen: 3**（M8、M14、M19，各计一次）。此项已纳入[代码标准](docs/code-standards.md)。

### 盖章预览的可见性与像素基准（M20，2026-11-28）

- 盖章由可用变为碰撞时，核对用户还能否看到旧章。桌面 Edge 中，碰撞提示已显示、所有带章导出已禁用，隐藏的 canvas 仍保留上一帧的像素。首次专项测试把隐藏的帧缓存计成旧章仍在显示。改为核对出错时画布隐藏、角位改正后画布重新可见且章区确有墨迹、清除后章区恢复空白。[首次失败](test-results/m20-evidence/qa-focused-final.log) · [四组复验](test-results/m20-evidence/qa-focused-proof-summary.json)　**Seen: 1**（M20）。
- 对交互预览和打印输出分别保留未盖章的对照页。两页表单在尚未盖章时，交互控件与压平页的抗锯齿已分别相差 5,014 和 4,461 个像素。以各自未盖章的同类页作对照后，章区外新增变化为 0。跨形态比较章区和二维码区，差异也均为 0。压平 ZIP 和合并 PDF 仍逐页比较全部像素。[初始跨形态对照](test-results/m20-evidence/worker-a/m20-preview-flatten-pairwise.log) · [4 倍像素断言](scripts/verify-pdf-pixels.py)　**Seen: 1**（M20 两种页面旋转共计一次）。

### 新增打印设置时核对关闭状态下的 Worker 调用（2026-11-28）

M20 新章三个打印输出均可下载。全套单元测试却发现，未启用章时，已有 ZIP 与合并调用也追加了值为 `undefined` 的位置参数。在新增选项启用前保留原参数列表，同时保留原有的精确调用断言。[三项独立复现](test-results/m20-evidence/qa-focus-regression.log) · [既有调用契约](tests/web/batch-exports.test.ts)　**Seen: 1**（M20，三个场景共用同一导出适配器）。

### Windows 验收日志里的阿拉伯数字（M22，2026-11-28）

在 Windows 的 GBK 输出环境运行四倍渲染时，M20 汇总中的阿拉伯数字触发了 `UnicodeEncodeError`，后面的 M21 和 M22 汇总没有输出。保留预检与 PDF 内原始 Unicode 值，让报告流只在不能编码的字符上使用反斜杠转义。用同一份清单分别以 GBK 和 UTF-8 复跑，两次都完整输出 M22 的两次填充、八个控件和零越界像素。[原错误](test-results/m22-evidence/worker-a/pixels-native.log) · [GBK 复跑](test-results/m22-evidence/worker-a/pixels-gbk-replay.log) · [冻结主线 UTF-8 复跑](test-results/m22-evidence/qa-pixels-native.log)

**Seen: 1**（M22）。此前已纳入标准的 RTL 扩展名检查在本次覆盖了组包的 ZIP 和 JSON 按钮。基线和冻结版本上，两种视口中点、字母与括号的实绘横坐标都严格递增。[基线坐标](test-results/m22-evidence/lead-baseline-rtl-extensions.json) · [Edge 回归](tests/e2e/m21-packets.spec.ts)

### 打印证书遇到字体无法显示的文件名（M24，2026-11-28）

移动端 Edge 接受了 `访客名单.csv`，两款证书内置字体都无法绘制其中的汉字。证书在纸面说明名称无法显示，并完整打印来源文件的 SHA-256。重新打开下载的 PDF 后，从 Subject 的 JSON 中逐字读回原始文件名。命令行给旋转模板取中文名也得到相同结果。后续改动证书排版时，保留一个内置字体无法覆盖的真实文件名，同时检查页面、原始名称和文件指纹。[浏览器下载验真](tests/e2e/m24-printshop.spec.ts) · [PDF 读回](tests/e2e/m24-print-proof.py) · [中文模板命令行回执](test-results/m24-evidence/lead-cli-rotated/receipt.json)

**Seen: 1**（M24，同一处证书排版限制计一次）。

### 脱敏后从就绪行取画布对照（M25，2026-11-28）

更改掩码会重新预检这一行，其间 PDF.js 也会绘制原始空模板。首次验收在桌面看到变化一直到画布纵坐标 202，超出了姓名框下沿 145。该次下载的 PDF 已有正确的脱敏字段值。测试现在等到该行重新就绪，再下载并核对同一行的字段值，然后采集可见画布。把掩码后的预览和一份直接输入相同星号的合成名单对照，英阿界面在两种视口均逐像素相同。**Seen: 1**（M25，两种视口测到同一取样问题）。[首次测量](test-results/m25-evidence/qa-focused/initial-results.utf16.json) · [取样和下载断言](tests/e2e/m25-dispatch.spec.ts) · [四组复验](test-results/m25-evidence/qa-focused/runtime/)

### 用可复现的同余样本界定 IBAN 承诺（M26，2026-11-28）

沙特合成号码 `SA9180B10000000000000000` 和 `SA91801B0000000000000000` 都符合该国结构。相邻的 `B1` 和 `1B` 展开后都得到 `111`，两个号码的 Mod-97 余数均为 1。新增校验规则时，将这对样本与普通数字笔误分别送入真实队列。前者逐行收到相邻换位待核对的诊断，后者收到校验位不符的诊断。审计和文案沿用这个区别，便于录入人员拿原始凭据逐字核对。**Seen: 1**（M26，两个方向共计一次）。[独立取余与穷举](test-results/m26-evidence/lead-iban-model.json) · [双语队列和下载回归](tests/e2e/m26-validation.spec.ts)

### 比对批次时分别验证 PDF 结构和保存的字段值（M27，2026-11-28）

首轮测试给第二批放入一份交叉引用位置无效的表单，PDF 读取库仍能恢复页面，批次比较随即给出了可供重印的结果。修复后，同一输入在 PDF 层报告 `invalid-pdf`，命令行退出 2，输出目录没有文件。验收时保留这份结构受损的输入，并用正常表单直接读取保存值。两份演示表单把 `/V` 存在父字段上，沿控件的 `/Parent` 读取后，能同时核对姓名与勾选值的实际变化。**Seen: 1**（M27）。[初次失败](test-results/m27-evidence/worker-core/m27-xref-red.log) · [修复后](test-results/m27-evidence/worker-core/m27-xref-green.log) · [命令行验收](test-results/m27-evidence/lead-diff-cli/receipt.json) · [父字段读回](test-results/m27-evidence/qa-focused/inherited-v-replay.json)
