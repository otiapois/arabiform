# ArabiForm v1.8.0 本机独立验收

五个离线 CLI 模式通过本机验收。两批人事证明的 10 份最终 PDF 与交接清单逐份匹配，姓名中的阿语音标和编号前导零可从可编辑 PDF 原样提取。真实 Edge 通过 138/138 项，完整保留 M1–M17 的 134 项。对抗测试接受 32,730 例，丢弃和失败均为 0。入口 JavaScript 为 269,287 B，gzip 为 84,089 B。[正式门禁收据](../../test-results/m18-evidence/qa-formal.json)

2026-11-28，独立 QA 在干净主线 `9aeeb15755599a96d97787f83022aba4926df05d` 上顺序验收。机器使用 Node 24.22.1、Python 3.13.11、PyMuPDF 1.26.7 和 Microsoft Edge 124.0.2478.80。PowerShell 默认找到 npm 6.14.5，本次使用 Node 随附的 `C:\Program Files\nodejs\npm.cmd` 11.19.1 转发参数。依赖、生成物、缓存及临时目录均位于 D 盘。[环境版本](../../test-results/m18-evidence/qa-versions.json) · [任务书](../tasks/M18-local-batch-cli-arabic-pdf-engine.md)

## 从合成模板到交付校验

在源码仓库根目录用 `npm --silent run arabiform-cli -- --mode …` 启动每个任务。原始参数、各自的 stdout、stderr、退出码和实际导出均已保留。[14 次实际调用](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/calls.json) · [双语命令与参数手册](../subsystems/cli-automation.md)

| 操作 | 实测结果 |
| --- | --- |
| 生成与预检 | `studio` 生成 `hr-letter-bilingual.pdf` 与 `hr-letter-bilingual-synthetic-sample.csv`。`preflight` 的 JSON 和 CSV 均列出两条通过记录。另将第一条姓名加长，两个文件均指出该行 `EmployeeName` 的 `too-narrow`，退出 2。带 `--strict` 的 `fill` 同样退出 2，目标目录未创建。[通过的 CSV](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/preflight/arabiform-preflight.csv) · [拒绝诊断](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/strict-refusal.stderr) |
| 填写与打印 | 第一批使用 CSV 和映射预设。第二批明确选择 XLSX 的 `Staff_AR` 工作表，按 `Department` 分组，开启封面、2-up 与交接 QR。两批均得到可编辑 ZIP、压平 ZIP、合并 PDF 和 v2 清单。独立解压并重算 8 个成员和 2 份合并 PDF 的 SHA-256，分别与 `entries`、`flattenedEntries`、`mergedPdfSha256` 完全一致。第二批两组各有独立 ZIP 路径，合并件共两页，封面后是两条记录的拼版页。[第一批清单](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/filled/custody-manifest.json) · [分组批次清单](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/grouped-print/custody-manifest.json) |
| 实绘与提取 | 第一批两份证明分别在 4 倍渲染下比较原模板、可编辑件、压平件和合并页。两张可编辑页与对应打印页逐像素一致，映射框外变化和裁切均为 0。`سَلْمَى بِنْتُ يَاسِين` 的姓名框有 2,586 个墨迹像素，距控件边界最近 8 个像素。`extract` 的 UTF-8 BOM CSV 与文本类型 XLSX 均保留完整姓名、`00123`、`00007` 及复选框原生值 `Yes`、`Off`，审计中的源文件及表格摘要也一致。[实际姓名字形](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/employee-name-render.png) · [提取表格](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/extract/arabiform-extracted.csv) |
| 验真与进程 | 三种 PDF 变体在 `verify` 中均返回 `VERIFIED_EXACT_MATCH` 和退出 0。已登记文件改一个字节后返回 `TAMPERED_BYTE_MISMATCH`。将已改字节另存为未列文件名则返回 `UNMATCHED_UNKNOWN`，二者均退出 2。清单中的 QR 返回 `VERIFIED_QR_RECORD`。输入目录缺失时退出 1。校验以传入的未签名清单为依据。[结果、摘要及像素明细](../../test-results/m18-evidence/qa-cli-receipt.json) |

终端处理需要本机源码、已安装依赖及随附字体。提取每次接受 1–200 份 PDF，整批 ZIP 和合并件需能装入本机内存。浏览器中的行编辑须写回源名单，映射预设另存为本地 JSON。打印日期可用 `--date` 固定。主执行端用另一份结业证书复跑了相同日期与输入，逐字节复核重复预检、重复填充及加水印导出。两次验收之间的 Git 差异仅涉及测试和截图。[CLI 使用边界](../subsystems/cli-automation.md) · [结业证书独立复算](../../test-results/m18-evidence/lead-cli-integrated/receipt.json)

## 工作台中的复制命令

英文首页与阿语 `/ar/` 跳转后的 `/ar/pdf-mail-merge` 均从收起状态开始。每个视口空载只请求一份入口 JS，打开命令帮助后仅追加该帮助的 JS。PDF、QR、字体处理 JS 的空载请求数均为 0。通过 Enter、Space、Tab 与 Shift+Tab 展开和收起、访问只读命令框、触发复制及核对反馈。四种语言和视口组合都从实际系统剪贴板读回了显示的完整命令。阿语布局为 RTL，命令框为 LTR。[Edge 测试](../../tests/e2e/m18-cli-helper.spec.ts) · [四组剪贴板与请求收据](../../test-results/m18-evidence/qa-edge-summary.json)

选中工作表 `دفعة (02)` 与分组列 `قسم & Team`，启用双语封面及两条拼版后，导出的 v9 预设、剪贴板命令和 CLI 解析器得到相同设置。切回 1-up 后命令随即更新。日期在浏览器模拟的上海 11 月 27 日凌晨取为 `2026-11-27`，此时 UTC 仍是前一天。三个截图均已打开核对，正式全套重拍与跟踪 PNG 字节一致。移动页面宽度实测 390 px。[英文桌面](screenshots/m18/desktop-m18-cli-helper-en.png) · [阿语桌面](screenshots/m18/desktop-m18-cli-helper-ar.png) · [阿语手机](screenshots/m18/mobile-m18-cli-helper.png)

## 正式门禁

| 检查 | 冻结主线结果 |
| --- | --- |
| 类型、单元与夹具 | `typecheck` 通过。`npm test` 的 25 个文件、185 项测试全部通过。只读复验 24 个夹具，`fixtures/.gitattributes` 的跟踪对象与工作副本均为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[单元日志](../../test-results/m18-evidence/qa-unit.log) · [夹具日志](../../test-results/m18-evidence/qa-fixtures.log) |
| 种子测试 | 种子 `1243704626`，55 项属性测试通过。原有 30,180 例之外，新增 1,100 例参数与路径、1,050 例拒绝与严格退出、200 例提取字节一致、50 例浏览器与 CLI 三种 PDF 输出字节一致，以及 150 例变体与改动校验，共新增 2,550 例。[逐组重算](../../test-results/m18-evidence/qa-fuzz-recount.json) · [运行日志](../../test-results/m18-evidence/qa-fuzz.log) |
| PDF 像素 | 65 次填充、202 个有墨迹控件，4 倍实绘裁切 0、框外变化 0。覆盖 4 个双语模板、12 张带 QR 的打印页和 12 张 A4 拼版。使用本地缓存的 4 份公开模板，其中 W-9 按 XFA 拒绝，另检验 Source Serif 4 的 CFF 字体。[完整像素证据](../../test-results/m18-evidence/qa-pixel-output/manifest-verification.json) |
| 发布构建 | 默认来源、严格来源及恢复默认后的 3 次全新构建和发布检查通过，占位来源的严格验证按预期退出 1。5 份静态 HTML 对应 5 条 sitemap 路由，CSP 含 `connect-src 'none'`，许可告知、字体许可与 CI 通过。入口较 PM 上限还剩 3,713 B 原始、1,711 B gzip，也满足正式硬上限。把 HTML 与入口 JS 的 gzip 大小相加，英文 86,897 B、阿语 87,900 B，分别较 M17 少 1,502 B、1,121 B，此比较不含 CSS、字体及 HTTP 报头。[发布清单](../../test-results/m18-evidence/qa-static.json) · [严格来源负例](../../test-results/m18-evidence/qa-default-reject.log) · [首屏大小](../../test-results/m18-evidence/qa-transfer.json) |
| 真实 Edge | 1440 × 900 和 390 × 844 各 69 项，统一使用本机 Edge，零重试。按文件、ID、标题和项目名与 M17 正式报告及本次基线清单双重比对，旧 134 项全部保留。6,706 个 HTTP 请求均在本地，外联、WebSocket 与浏览器错误各 0。退出后复查 42885 端口已关闭。[运行记录](../../test-results/m18-evidence/qa-edge.log) · [主执行端独立重算](../../test-results/m18-evidence/lead-edge-recount.json) |

## 首次失败与修正

- 首次在 `7f3a02f` 运行整套单元测试时，3 项发布检查因临时测试包缺少新增的 `workbench-labels.json` 失败。保留该轮日志后停止旧进程。补入这一份文件后，原有三项断言独立复跑 3/3 通过，随后在最终冻结版本完成全套。[首次主线记录](../../test-results/m18-evidence/qa-stopped-7f3a02f/stop.json) · [缺件复现](../../test-results/m18-evidence/worker-b/release-fixture-red.log) · [修复后](../../test-results/m18-evidence/worker-b/release-fixture-green.log)
- Windows 沙箱在 tsx 初始化时返回 `uv_os_get_passwd ENOMEM`，像素门禁与首个 CLI studio 均在读取业务输入前退出。在获准的本机环境，使用相同版本、D 盘输入及临时目录重跑原命令，像素和五模式均完成。[像素首次失败](../../test-results/m18-evidence/qa-pixels.log) · [原命令完成](../../test-results/m18-evidence/qa-pixels-native.log) · [CLI 首次 stderr](../../test-results/m18-evidence/qa-cli-9aeeb15-local/studio.stderr)
- QA 首版网络计数器把 tsx 的本机命名管道事件记为 TCP 尝试。核对原始端点后独立标记无端口的 D 盘管道，重新执行全部 14 次调用。42 个 Node 进程合计 28 次本机管道事件，HTTP 请求、TCP 尝试及 TCP 连接均为 0。[首次观测复核](../../test-results/m18-evidence/qa-cli-9aeeb15-native/observer-first-pass.json) · [最终逐进程记录](../../test-results/m18-evidence/qa-cli-9aeeb15-native-final/network.jsonl)
