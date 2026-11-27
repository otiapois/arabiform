# ArabiForm v2.1.0 本机独立验收

M21 已在冻结主线 `5f29ef4ccd57a1f9dbbeb2d64ee064a42c32ddbd` 通过验收。英文与阿语工作台均可用同一份名单生成每人一份多文档 PDF。实测第二份表格容不下姓名时，整个人的包被拦下，其余就绪人员照常下载。默认单元测试 217/217，固定种子接受 40,454 例，真实 Edge 158/158。69 项四倍渲染对照的控件裁字和框外变化像素均为 0。[正式命令与退出码](../../test-results/m21-evidence/qa-formal.json)

## 实际下载

| 从哪里操作 | 下载后独立核对 |
| --- | --- |
| 英文首页和阿语 RTL 填表页的合成示例 | 同一份 CSV 有 3 人，2 人就绪，第 3 人在第 2 份同意书的 Consent 字段被拦下。ZIP 只有 `00001-packet.pdf` 和 `00002-packet.pdf`。每份依次为双语目录、两页 HR 表、一页同意书，目录起页为 2、4。 |
| 手动上传两份 PDF 和同一份 CSV | HR 和横式访客证的 Name 分别绑定名单中的 Name 与 Badge print。第 1 人的实际打印页分别含 `HR One` 和 `MYA`。第 2 人在访客证的 Name 遇到 `too-narrow`，ZIP 只含 `Intake/00123-packet.pdf`。把访客证移到首位后，旧下载立即禁用，重验指出第 1 份模板。重置也清除旧结果。 |
| 离线 CLI | 全就绪返回 0。混合名单返回 2，只有就绪人员的完整 PDF。全拦截和第 2 份模板为 XFA 各返回 2，均无输出文件。两个可下载结果中的同一位就绪人员 PDF 字节完全相同。主执行端另用四份表与选定 Excel 工作表复核了第 3 份表拦截、分组和六页输出。 |

逐份重开 ZIP 成员，用实际输入 PDF、原始名单字节和最终 PDF 重算 SHA-256，核对清单中的顺序、字节数、原始行号、路径和起页。用 PyMuPDF 检查双语目录、每页四倍墨迹和零交互控件。四组浏览器环境共读回 12 份 PDF。原始下载与独立复算均可复查。[Edge 测试](../../tests/e2e/m21-packets.spec.ts) · [桌面英文示例的原件、清单与读回](../../test-results/m21-evidence/qa-runtime/m21-packets-M21-en-synthet-6d14f-page-HR-and-consent-packets-desktop/demo/) · [四个冻结 CLI 场景](../../test-results/m21-evidence/qa-cli/receipt-native.json) · [四模板与模板拒绝对照](../../test-results/m21-evidence/lead-native-packet.json) · [主执行端复算](../../test-results/m21-evidence/lead-edge-recount.json)

主执行端再将 CLI 的字段映射与浏览器逐项对齐，包括 HR 自动映射的 Employee ID。用同一份名单原字节复跑，CLI 的 PDF、清单和各页四倍渲染与英阿两种语言、两个视口的实际下载全部一致。[浏览器与 CLI 逐字节对照](../../test-results/m21-evidence/lead-browser-cli-parity/receipt.json)

## 浏览器与截图

Microsoft Edge 124.0.2478.80 在 1440 × 900 和 390 × 844 各通过 79 项。把上一版实际 Edge 报告和开工时的用例清单按文件、标题、用例 ID、项目 ID 逐项匹配，原有 150 项全部保留。新增 8 项，整套无跳过、失败、重试。158 份运行记录合计 8,848 次同源请求，外部请求、WebSocket、控制台及 HTTP 错误均为 0。运行器退出后，端口 42927 拒绝新连接。[逐项对照](../../test-results/m21-evidence/qa-baseline-reconciliation.json) · [Playwright 原始报告](../../test-results/m21-evidence/qa-edge-report.json) · [网络、焦点与对比度实测](../../test-results/m21-evidence/qa-runtime-summary.json)

冷启动均默认选择 Fill PDFs。点击组包前，两种语言都只加载入口 JS，组包、PDF、QR、字体处理引擎均延后加载。加载样本后，390 px 页面无横向溢出。手机结果区宽度与滚动宽度均为 338 px，显示完整文件名和第 2 份同意书的行级原因。键盘能按当前阅读方向切换模板标签。正文的最低实测对比度为 5.57∶1，控件辨识线索 3.21∶1，焦点环 5.88∶1。[英文桌面示例与映射](screenshots/m21/desktop-m21-packet-en.png) · [阿语桌面就绪与拦截](screenshots/m21/desktop-m21-packet-ar.png) · [阿语手机结果](screenshots/m21/mobile-m21-packet.png)

## 引擎、静态发布与回放

| 项目 | 冻结主线结果 |
| --- | --- |
| 类型与单元 | TypeScript 通过。默认 `npm test` 通过 28 个文件、217 项测试。[类型检查](../../test-results/m21-evidence/qa-typecheck.json) · [单元日志](../../test-results/m21-evidence/qa-unit.log) |
| 固定种子 | 种子 1243704626。原有 37,904 例，本次新增 2,200 例跨模板预检与 350 例真实 ZIP 回读，合计接受 40,454、丢弃 0、失败属性 0。重型用例显式超时配置均至少 180,000 ms。[实际计数](../../test-results/m21-evidence/qa-fuzz-verbose.log) · [超时与统计](../../test-results/m21-evidence/qa-fuzz-summary.json) |
| 夹具与像素 | 24 份合成夹具逐份一致。PyMuPDF 1.26.7 保留 M20 的全部 67 个既有填充及 4 个公开模板结果，新增英文双页 HR 和阿语附标姓名、前导零 ID 与同意项。组包的 3 个正文页逐像素等于分别压平的原件。目录两个条目起于第 2、4 页，英阿标题分别有 14,065 和 8,314 个墨迹像素。组包剩余控件、裁切像素、映射区外变化均为 0。[夹具](../../test-results/m21-evidence/qa-fixtures.log) · [像素报告](../../test-results/m21-evidence/qa-pixel-summary.json) · [原始 PDF 与渲染清单](../../test-results/m21-evidence/qa-pixel-output/) |
| 构建与静态站点 | 默认来源、独立构建的严格来源 `https://release.arabiform.test`、恢复默认后三次均通过。每次均为 5 个 HTML 路由，入口 268,364 B，gzip 83,599 B，符合 269,000 / 84,200 B 目标。CSP 含 `connect-src 'none'`。来源检查拒绝显式占位域名，也拒绝仍带占位域名的旧产物。许可证、字体声明与 CI 检查通过。[路由与入口字节](../../test-results/m21-evidence/qa-release-summary.json) · [严格来源](../../test-results/m21-evidence/qa-strict-release.log) · [旧产物拒绝](../../test-results/m21-evidence/qa-strict-placeholder-artifacts.log) |

夹具属性仍为基线 Git 对象 `16687c743d52cd6832cb834023e0b8160b38bf1e`。Windows 工作副本的 CRLF 原始字节 SHA-256 与开工前完全一致，PDF、XLSX 的 binary 规则和 CSV 的 `-text whitespace=cr-at-eol` 规则均保留。[基线与当前字节](../../test-results/m21-evidence/lead-fixture-bytes.json)

首次像素命令和 CLI 在受限 Windows 环境的 tsx 初始化处因 `uv_os_get_passwd ENOMEM` 退出。两者在获准的本机环境使用相同冻结提交和 D 盘输入复跑通过。默认单元报告省略了 fast-check 汇总行，单独启动的默认 fuzz 运行在生成汇总计数前由 QA 结束。正式专项使用同一测试文件和 verbose 报告器，日志直接记录接受、丢弃与失败数。[像素首次退出](../../test-results/m21-evidence/qa-pixels.log) · [本机像素](../../test-results/m21-evidence/qa-pixels-native.log) · [CLI 首次退出](../../test-results/m21-evidence/qa-cli-sandbox-ready.log) · [报告器切换回执](../../test-results/m21-evidence/qa-fuzz-reporter-switch.json)

## 主线收尾

64 个核心文件的边界扫描中，DOM、网络和文件系统 API 匹配数均为 0。锁文件只更新版本号。冻结后的变更限于报告、经验和代码标准。[核心与锁文件核验](../../test-results/m21-evidence/lead-core-invariants.json) · [五路由入口复算](../../test-results/m21-evidence/lead-static-recount.json)

已清理四个工作树、对应分支及 D 盘 `.arabiform-wt`。Windows 曾暂时占用已注销的文档工作树目录，核对为空后重试删除成功。Git 只登记 `main`，两个本地预览端口均关闭，夹具属性文件与开工前逐字节一致。[清理回执](../../test-results/m21-evidence/lead-worktree-cleanup.json)
