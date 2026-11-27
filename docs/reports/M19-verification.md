# ArabiForm v1.9.0 本机独立验收

M19 的边界行跳转、双行预览和用纸估算通过本机验收。6 条可打印记录分属两组，启用双语封面后，整批合并由 7 张降到 4 张，按组拆分由 8 张降到 6 张。独立解析了从浏览器下载的 16 份合并 PDF 和 32 份分组 PDF，逐份与界面一致。冻结主线的真实 Edge 通过 146/146 项，完整保留原有 138 项。[正式门禁](../../test-results/m19-evidence/qa-formal.json) · [下载及浏览器证据](../../test-results/m19-evidence/qa-edge-summary.json)

2026-11-28，QA 在干净主线 `b968a29f62c9d8c640bb6210e8dc2e36c1d6a27e` 顺序运行正式门禁。独立验收使用 D 盘的依赖、公开模板、缓存与临时目录，使用 Node 随附的 npm 转发参数。[任务书](../tasks/M19-batch-preview-gallery-sheet-estimator.md) · [环境版本](../../test-results/m19-evidence/qa-versions.json)

## 名单与渲染

在英文首页和经 301 跳转的阿语 `/ar/` 分别上传一页横式 AcroForm 证明与七行双语 CSV。第 5 行有最长的带音标阿语姓名，第 2 行的编号长度超过 PDF 字段限制。三个快捷入口准确选中原名单第 5、1、2 行，第 1 行是使用最小字号的最早记录。第 2 行在主预览及比较窗中都显示了原模板、ID 的 MaxLen 诊断与状态。测量框内像素后，其姓名区域的深色墨迹为 0。[Edge 用例](../../tests/e2e/m19-print-planning.spec.ts)

并排查看第 1 行英文姓名 Al 与第 5 行阿语姓名时，实际字号均为 19 pt，最小墨迹净距分别为 2.6 pt、3.531 pt。从实际下载的 1-up 合并件重新读取，两行的字体均为 19 pt。以 PyMuPDF 4 倍渲染测得最近的实绘净距为 2.5 pt、3.5 pt，和界面的差值均在一个像素（0.25 pt）内。桌面采到 23、220 个姓名深色像素，手机为 14、125 个。两份 PDF 的画布哈希不同，像素尺寸足以覆盖各自的 CSS 显示尺寸。桌面双栏按当前界面语向排序，390 × 844 手机把两栏上下排列，页面和正文宽度均为 390 px。三个交付截图都已打开核对，两张比较截图均能读到两份已经绘制的证明和各自的编号。[英文桌面比较](screenshots/m19/desktop-m19-row-compare-en.png) · [阿语手机比较](screenshots/m19/mobile-m19-compare.png)

## 下载文件逐份复算

下表数字来自两种语言和两个视口的真实下载。每种设置都用 pdf-lib 打开合并件和 ZIP 内的每一份 PDF，再用 PyMuPDF 独立读回。拆分清单同步核对每组的原始行号，带封面的每份 PDF 都在第一页读到英、阿两种标题。[阿语桌面估算](screenshots/m19/desktop-m19-estimator-ar.png) · [PDF 页数与行号](../../test-results/m19-evidence/qa-edge-summary.json)

| 输出设置 | 合并 PDF | North | South | 分组共计 |
|---|---:|---:|---:|---:|
| 6 条就绪，1-up，无封面 | 6 | 3 | 3 | 6 |
| 6 条就绪，1-up，双语封面 | 7 | 4 | 4 | 8 |
| 6 条就绪，2-up，双语封面 | 4 | 3 | 3 | 6 |
| 仅选第 1、5 行，2-up，双语封面 | 2 | 2 | 2 | 4 |

整批切换 2-up 节约 3 张（42.86%），分组节约 2 张（25%）。最后一项先选第 1、4、5 行，再取消第 4 行，分组清单只列 North 的第 1 行和 South 的第 5 行。第 2 行在四种设置中始终被排除。主执行端另用 35 条长文件名记录复算三页封面，将 M18 和 M19 输出的 9 份 PDF 逐字节比较，全部相同。另测不支持 2-up 的多页模板，按有效 1-up 设置得到合并 13 张、分组 14 张。[跨版本 PDF 与独立页数复核](../../test-results/m19-evidence/lead-print-pymupdf.json)

## 正式门禁

| 检查 | 冻结主线实测 |
|---|---|
| 类型、单元及夹具 | `typecheck` 通过，26 个测试文件的 192 项全部通过。只读复验 24 个夹具，`fixtures/.gitattributes` 的跟踪与工作副本 Git 对象均为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[单元](../../test-results/m19-evidence/qa-unit.log) · [夹具](../../test-results/m19-evidence/qa-fixtures.log) |
| 固定种子 | 种子 `1243704626`，59 项属性、35,254 个接受案例，丢弃与失败均为 0。保留 M18 的 32,730 例，增加 1,500 次边界行排序、500 个连续规模的封面排版、500 个分组及选集，以及 24 次实际合并件与分组件回读。最后一组含 500 条记录的双语批次。[分类重算](../../test-results/m19-evidence/qa-fuzz-recount.json) · [运行日志](../../test-results/m19-evidence/qa-fuzz.log) |
| PDF 实绘 | PyMuPDF 1.26.7 在 4 倍下核验 65 次填充、202 个有墨迹控件，裁切与映射框外像素变化均为 0。另检验 10 张封面、84 条页码索引、12 张 A4 拼版、4 个双语模板，以及 D 盘缓存的 4 份公开 PDF 和一份 Source Serif 4 CFF 字体。W-9 依 XFA 规则拒绝。[实绘清单](../../test-results/m19-evidence/qa-pixel-output/manifest-verification.json) · [像素日志](../../test-results/m19-evidence/qa-pixels-native.log) |
| 构建与发布核验 | 默认来源、严格来源和恢复默认三次全新构建均通过。严格校验占位域名时按预期退出 1。实际入口为 269,722 B、gzip 84,283 B，距严格上限分别还有 4,278 B、1,517 B。发布检查覆盖五个静态页面、sitemap、robots、许可、CI 与 CSP 的 `connect-src 'none'`。这些结果来自本机构建。[静态清单](../../test-results/m19-evidence/qa-static.json) · [严格来源负例](../../test-results/m19-evidence/qa-default-reject.log) |
| 真实 Edge | Microsoft Edge 124.0.2478.80，1440 × 900 和 390 × 844 各 73 项，146/146 通过，零重试。按测试文件、ID、标题和项目名与 M18 实跑及本次基线清单双重核对，旧 138 项完整保留。8,022 个 HTTP 请求均为本机请求，浏览器错误、外联与 WebSocket 均为 0。运行结束时 42885 已拒绝连接。[原始报告](../../test-results/m19-evidence/qa-edge-report.json) · [主执行端独立重算](../../test-results/m19-evidence/lead-edge-recount.json) |

四种语种与视口组合的空载脚本均只有入口 JS。阿语页面另读两份本地显示字体，PDF、QR、字体处理、估算和比较脚本的空载请求均为 0。实测比较面板和分组估算展开时，整页文本对比度最低 5.65∶1、控件边界 3.21∶1、焦点环 5.88∶1。正式全套重拍的三份截图与交付 PNG 的 SHA-256 逐份一致。[空载请求、对比度及图片摘要](../../test-results/m19-evidence/qa-edge-summary.json)

500 条长文件名与多页封面会增加首次估算时间。开发工作树的固定输入首算 5.10 秒，切换为 250 条选集后为 136 毫秒。两次分别得到整批 277 张和 264 张，仅代表该组本机输入。[规模测量](../../test-results/m19-evidence/worker-a/m19-filename-reuse-500-row-timing.log)

## 首次失败与修正

- M5 首轮观察器所依附的外层队列在上传后被替换，双语、双视口的四个测试均漏收阶段文案。修复保留了稳定队列节点，上传前开始记录真正的 live 区域变化，并核对最后 5 条就绪、0 条标记。专项和冻结主线中的原有四项均通过。该经验结合 M8、M14 的独立失败证据纳入代码标准。[首轮失败](../../test-results/m19-evidence/worker-b/m5-e2e.log) · [专项复验](../../test-results/m19-evidence/worker-b/final-m5-e2e.log) · [代码标准](../code-standards.md)
- 首版 QA 在更改输出设置后直接查找分组明细，浏览器已把明细收起，出现控件定位超时。改为从可见的摘要重新展开，继续逐组核对屏幕上的张数与已下载文件。[首轮 QA](../../test-results/m19-evidence/qa-focused.log) · [专项复验](../../test-results/m19-evidence/qa-focused-stable-summary.json)
- 沙箱中的 tsx 在准备临时目录时返回 `uv_os_get_passwd ENOMEM`。冻结提交、命令、模板、字体和 D 盘临时目录保持一致，获准的本机复跑完成了全部像素检查。开发工作树此前有一轮旧版本的重复模糊测试按主执行端指令中止，正式总数来自冻结主线完整运行。[首次像素启动日志](../../test-results/m19-evidence/qa-pixels.log) · [本机复跑](../../test-results/m19-evidence/qa-pixels-native.log) · [早期开发轮中止收据](../../test-results/m19-evidence/worker-a/fuzz-first-interrupted.json)
