# ArabiForm v1.6.0 本机独立验收

M16 通过本机发布验收。8 条英阿双语记录按 6 个分组导出，两种 ZIP 的实际 PDF、哈希和封面页码均吻合。新设计的下拉与单选字段在填表和提取后保留原值。真实 Edge 130/130 项通过，包含原有全部 122 项。57 次填充的 4× 实绘均无裁切或框外变化。[正式命令与退出码](../../test-results/m16-evidence/qa-formal.json) · [正式 Edge 收据](../../test-results/m16-evidence/qa-edge-summary.json)

## 验收范围

2026-11-27，独立 QA 在干净的 `main` 提交 `a8acc088d8762e5f9ed785f6a43d0fb6eb3244eb` 上运行发布检查。使用已安装的 Microsoft Edge 124.0.2478.80，桌面为 1440 × 900，移动为 390 × 844 触屏模拟。浏览器只访问本机生产构建，临时文件、缓存与下载证据均在 D 盘。[任务书](../tasks/M16-grouped-zip-split-designer-choices.md) · [浏览器回归用例](../../tests/e2e/m16-grouped-designer.spec.ts)

## 从同一份名单下载两种分组 ZIP

英文、阿语各用两种视口载入真实 AcroForm 和同一份 UTF-8 合成名单。默认选择单目录，在输出设置选中精确列名 `Clinic` 后，8 条就绪记录分入 6 组。全组选用 `{{ID}}.pdf` 命名，逐份解包后从 PDF 表单读回原姓名与编号。下表中的页码来自每份拆分 PDF 的实际封面，封面为第 1 页。[桌面分组及下载按钮](screenshots/m16/desktop-m16-grouped-export.png) · [阿语手机分组及下载按钮](screenshots/m16/mobile-m16-grouped.png)

| 原始组值 | ZIP 子目录 | 原名单行号 | 独立 PDF 文件名 | 双语封面中的本组 A4 页码 |
|---|---|---|---|---|
| الرياض | الرياض | 1、3、6 | `00123.pdf`、`00123-2.pdf`、`00006.pdf` | 2、2、3 |
| Jeddah | Jeddah | 2 | `00123.pdf` | 2 |
| 空值 | `_Ungrouped` | 4 | `00004.pdf` | 2 |
| `CON` | `_CON` | 5 | `00005.pdf` | 2 |
| `West/A` | `WestA` | 7 | `00007.pdf` | 2 |
| `WestA` | `WestA-2` | 8 | `00008.pdf` | 2 |

实际点击 **Download Clean PDFs (.zip)**，ZIP 内只有这 8 个安全相对路径。按源行比对 CSV 和 JSON 审计的 `zipPath`，再对独立下载的 custody manifest 逐个核查路径、字节数、SHA-256 和两份源文件的 SHA-256。搜索 `00123-2.pdf` 时只命中第 3 行，队列和所选行摘要均与下载结果一致。[正式浏览器下载的独立重读](../../test-results/m16-evidence/lead-final-edge-readback.json)

勾选双语封面和 A4 两条记录拼版，点击 **Download Split Merged PDFs by Group (.zip)**。实际收到 6 份 `<组名>-merged.pdf` 和根目录 `batch-custody.json`。逐组校验清单中的原始组值、输出名、原行号、字节长度和 SHA-256，另行下载的 custody manifest 与之吻合。所有 PDF 均已压平。每张封面的英阿标题、逐条文件名、原始行号和本组页码均从原始 PDF 内容流读回。主执行端另对原行 2、4 做子集导出，以 4× 渲染核查各组水印、源摘要前缀、页索引和印刷内容。[独立分组实绘](../../test-results/m16-evidence/lead-grouped-replay/proof-4x.json)

## 从平面 PDF 设计选择字段，再提取实际填入的值

桌面鼠标与手机触控分别在 `fixtures/golden/flat.pdf` 上放置 `Clinic` 下拉框、`Contact` 单选组的两个控件。按行输入 `RIY`、`JED`、`جدة`，应用后导出模板。模板含标准 `/FT /Ch` Combo 和 `/FT /Btn` Radio。每个单选控件的正常外观同时含非空 Off 与选中状态，模板初始状态均为 Off。[桌面设计器实图](screenshots/m16/desktop-m16-designer-choices.png)

点击 **Use in Fill PDFs Now**，载入包含前导零 ID 的名单，并按现有工作台规则将两个选择字段显式映射到同名列。实际 ZIP 中的三个 PDF 分别读回 `RIY / CALL`、`JED / MAIL`、`جدة / MAIL`。每次只有一个单选控件的 `/AS` 与字段的 `/V` 对应。把同一份下载字节交给 M14 提取器，CSV、JSON 和行结果显示的值都正确。逐个重算输入 PDF 和导出 CSV 的 SHA-256。另用 PyMuPDF 4× 比较两个视口实际下载的 6 份文件，所有已填控件均无墨迹裁切和框外像素变化。[正式下载的双引擎复核](../../test-results/m16-evidence/lead-final-edge-readback.json)

同一轮保存真实 v9 映射预设，再依次导入 v1–v8。每次旧预设都能恢复自己的文件名模式和拼版设置，并回到单目录，再次导入 v9 可恢复 `Clinic`。换入只有小写 `clinic` 的名单后，原预设明确提示缺少列，并禁用 ZIP 与审计。手动选择当前表头即可继续。

## 浏览器兼容、隐私与可访问性

正式套件单工作进程、零重试，桌面和移动各通过 65 项。按测试文件、用例 ID、标题及浏览器项目逐条匹配，上版 17 个文件中的全部 122 条记录均已实际运行，新增 8 条。运行耗时 14.4 分钟，共记录 6,072 个本地请求。外部请求、WebSocket、HTTP、控制台和运行时错误均为 0。套件退出后，预览端口 42875 已关闭。[上版用例身份](../../test-results/m16-evidence/e2e-baseline-list.json) · [正式运行清单](../../test-results/m16-evidence/qa-edge-report.json) · [请求与端口汇总](../../test-results/m16-evidence/qa-edge-summary.json)

两种视口分别冷启动英文与阿语工作台，检查了所有 `.js` 和 `.mjs` 请求，仅观察到单个入口脚本。分组与设计器交互后，以 Edge 计算实际渲染颜色，普通文字最低 5.65∶1，控件边界提示最低 3.21∶1，键盘焦点最低 5.88∶1。移动端载入、选字段、导出后，页面实测宽度均为 390 px。三张正式截图均已打开核对。[逐场景测量](../../test-results/m16-evidence/qa-edge-summary.json)

## 核心、像素与发布

| 验收项 | 冻结主线实测 |
|---|---|
| 类型、单元与夹具 | `npm run typecheck` 通过，23 个文件共 167/167 个 Vitest 测试通过。24 个合成夹具逐字节校验一致。`fixtures/.gitattributes` 的 Git blob 为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[单元日志](../../test-results/m16-evidence/qa-unit.log) · [夹具日志](../../test-results/m16-evidence/qa-fixtures.log) |
| 固定种子 | 种子 1243704626，46 个 Vitest 测试通过，45 组生成式属性共 27,680 个已接受案例，丢弃和失败均为 0。独立读取 TypeScript 调用参数，原有 25,160 例完整保留，新加 850 个分组路径、620 个拆分索引、800 个预设及 250 个实际设计、填充和提取案例。[执行结果](../../test-results/m16-evidence/qa-fuzz.log) · [独立重数](../../test-results/m16-evidence/qa-fuzz-recount.json) |
| PyMuPDF 实绘 | 在 1.26.7 上以 4× 比较 57 次填充、165 个有墨迹控件，裁切和框外变化均为 0，最小边缘内距 6 px。含四个旋转角度的 8 次新设计阿英下拉及单选填充。两份新拆分包在 3 张 A4 上容纳 5 条记录，封面逐条指向正确纸张。整个套件有 10 张封面、84 条索引、8 张 A4、13 条矢量打印记录及 104 条裁线。公开样本中 3 份可填，含 XFA 的 W-9 按合同拒绝。[完整原图与实绘结果](../../test-results/m16-evidence/qa-pixel-output/manifest-verification.json) |
| 五路由与发布预算 | 五个规范 URL、五份静态 HTML 共用同一个入口，原始 275,810 B，gzip 86,680 B，分别低于门限 2,190 B、320 B。默认域、严格测试域均通过；用严格域验证默认占位构建时按预期失败，最后恢复默认构建并复验。CSP 包含 `connect-src 'none'`。站点地图、robots、许可和 CI 核查通过。[静态清单](../../test-results/m16-evidence/qa-static.json) · [严格域](../../test-results/m16-evidence/qa-strict-release.log) · [占位域负例](../../test-results/m16-evidence/qa-default-reject.log) |

## 实测中修正与复跑的项目

- 开发版曾给另一组里的首份同名文件加上 `-2` 并提示重名。修复后，队列、搜索、所选行和实际下载都按各自目录判重。[初次失败](../../test-results/m16-evidence/worker-b/grouped-preview-red.log) · [当前回归](../../tests/e2e/m16-grouped-designer.spec.ts)
- 390 px 的阿语按钮曾将扩展名画成 `(zip.)`。隔离 `(.zip)` 的方向后，点位于 z 左侧，边界、字母与括号在同一行按顺序显示，页面宽度为 390 px。M3、M7、M16 三个周期的扩展名检查已纳入代码标准。[修复前](../../test-results/m16-evidence/worker-b/split-extension-before.json) · [修复后](../../test-results/m16-evidence/worker-b/split-extension-after.json) · [代码标准](../code-standards.md)
- QA 的初版浏览器用例省略选择字段映射，预检停在未就绪。按真实界面手动映射后，聚焦测试 8/8 通过。随后正式类型检查发现测试给 pdf-lib 的 `lookup` 传入了该版本类型声明未列出的构造函数。增加运行时流类型检查，在新冻结版本从头复跑。[首轮浏览器日志](../../test-results/m16-evidence/qa-focused-a.log) · [类型检查原始收据](../../test-results/m16-evidence/qa-before-typecheck.log) · [修正后类型检查](../../test-results/m16-evidence/qa-typecheck.log)
- Windows 沙箱在 tsx 初始化时返回 `uv_os_get_passwd ENOMEM`。按既有代码标准在获准的本机环境，从同一提交、同一 D 盘输入重跑原命令 `npm run verify:pixels`，57 次实绘全部完成。[启动错误](../../test-results/m16-evidence/qa-pixels.log) · [本机重跑](../../test-results/m16-evidence/qa-pixels-native.log)

## 主线收尾

主执行端扫描了 `src/core/` 下 47 个跟踪文件，DOM 和网络 API 命中均为 0。[核心扫描](../../test-results/m16-evidence/lead-core-invariants.json)

四棵 M16 工作树与对应的已合并分支均已清理。Git 注销文档工作树时，Windows 暂时锁住了一个空目录。确认目录为空且已注销后重试删除。现在 Git 仅列出 `main` 工作树，D 盘 `.arabiform-wt` 已移除，主线依赖仍可用，四个验收端口均已关闭。[清理回执](../../test-results/m16-evidence/lead-worktree-cleanup.json)
