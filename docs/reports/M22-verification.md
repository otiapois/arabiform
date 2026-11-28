# ArabiForm v2.2.0 本机独立验收

冻结主线为 `0add2639f195e31021c197a1900b5fcf55476e1c`。在真实 Microsoft Edge 的英文和阿语工作台中，条件填表能用同一份名单生成不同结果。VIP 姓名变为 `كبار الشخصيات / VIP`，两处同意框同时选中。普通行保留源姓名，两处同意框均未选中。把 VIP 横幅改为超宽阿语后，下载只包含普通行。

独立验收通过。默认单测 228/228，固定种子接受 42,984 例，丢弃和失败均为 0。桌面与手机 Edge 166/166；沿用上版全部可选输入时，71 组四倍渲染的边缘裁切和框外变化均为 0。[冻结提交、正式命令与退出码](../../test-results/m22-evidence/qa-formal.json)

## 从操作到下载

| 场景 | 独立核对结果 |
| --- | --- |
| 默认示例与实时预览 | 两条规则各命中 2 人中的 1 人。直接读取当前行 PDF.js 画布的三个控件内部像素。恢复 v10 时两处勾选框内深色像素都降为 0，姓名区哈希也改变。重新导入原先导出的 v11，姓名与两处勾选框的像素哈希全部恢复。 |
| 手工上传与优先级 | 用实际 PDF 与原始 CSV 手工创建三条规则。把第三条移到首位，同一姓名的命中从原规则转到新规则，下载的姓名变成 `Priority 00123`。删除它之后，双语横幅恢复。正常与超宽两次下载均在解包后重开，并核对两个 Consent 控件及未映射 Sentinel 的原值和外观流哈希。 |
| 诊断与兼容 | v11 的 CSV 和 JSON 逐行对照。VIP 行记录首条姓名与第二条同意规则，普通行记录空数组。超宽时 VIP 行保留规则来源，姓名诊断为 `too-narrow`。v10 恢复后两行使用原值，原审计格式不含 `ruleApplied`。 |
| 离线 CLI | 独立 Node 子进程运行真实浏览器导出的 v11。严格填充返回 0，同一模板和原始名单产生的两份 PDF 与 Edge 下载逐字节一致。再用 CLI 提取姓名，PyMuPDF 独立读取两人四处复选状态和 Sentinel。超宽规则预检返回 2，计 1 人就绪、1 人待修，严格填充返回 2 且输出文件数为 0。 |

[实际 Edge 操作与读回断言](../../tests/e2e/m22-conditional-rules.spec.ts) · [CLI 原始输入、输出与读回](../../test-results/m22-evidence/qa-cli/) · [四行扩展名单的选择字段、规则来源及四种拒绝原因](../../test-results/m22-evidence/lead-m22-native.json)

主执行端另取正式 Edge 套件中英阿两种语言、两个视口的原始上传文件和下载预设。四次上传的输入字节一致。用该预设执行严格 CLI 填充后，两份 PDF 的完整文件字节和规则来源与四组浏览器结果逐项相同。[四组正式浏览器与 CLI 的对照](../../test-results/m22-evidence/lead-browser-cli-parity/receipt.json)

[桌面英文规则编辑](screenshots/m22/desktop-m22-rules-en.png) · [桌面阿语成品预览](screenshots/m22/desktop-m22-rules-ar.png) · [390 px 阿语规则编辑](screenshots/m22/mobile-m22-rules.png)

## 真实 Edge 与可访问性

Microsoft Edge 124.0.2478.80 使用一个工作进程串行运行。1440 × 900 与 390 × 844 各通过 83 项，共 166/166。将 M21 实跑报告、开工时冻结的清单和本次原始报告按用例文件、标题、ID 和项目逐项匹配，原有 158 项全部保留，新增 8 项。全套无失败、跳过或重试。166 份逐案运行记录共观察到 9,583 次同源 HTTP 请求，外部请求、WebSocket、HTTP 和浏览器错误均为 0。预览结束后，基线、QA 和界面验收端口 11185、42927、42928 的回环 TCP 连接均返回拒绝。[逐案报告](../../test-results/m22-evidence/qa-edge-report.json) · [身份及运行记录汇总](../../test-results/m22-evidence/qa-edge-summary.json) · [主执行端独立复算](../../test-results/m22-evidence/lead-edge-recount.json) · [端口复核](../../test-results/m22-evidence/qa-ports.json)

四组加载规则的场景中，空载只请求一个入口 JS；加载规则面板前，PDF、QR、嵌入字体和规则代码均未请求。填入示例后逐个核对正文、可操作控件和键盘焦点，四组对比度最低分别为 5.64∶1、3.20∶1、5.88∶1（向下取两位小数）。手机页面、正文和视口宽度均为 390 px。组包下载按钮 `(.zip)` 和 `(.json)` 的每个字符在 RTL 下实绘横坐标严格递增。三张归档截图与正式复跑的原始 PNG 哈希一致。[实测对比度、画布与坐标](../../test-results/m22-evidence/qa-edge-summary.json) · [截图 SHA-256](../../test-results/m22-evidence/qa-screenshots.json)

## PDF 与静态交付

类型检查通过。默认 `npm test` 涵盖 30 个测试文件、228 个用例。另用 verbose 报告器运行同一份 fuzz 源文件，70 项属性全部通过。种子 1,243,704,626 从 M21 的 40,454 例增加到 42,984 例。新增 2,530 例分别覆盖顺序与运算符 650、精确小数 700、模板代入与非法目标 600、预设版本 550、真实填充与提取 30。预设覆盖 v1 至 v11。默认单项超时为 180,000 毫秒，显式超时中 39 项为 180,000 毫秒、1 项为 300,000 毫秒。[类型检查](../../test-results/m22-evidence/qa-typecheck.log) · [默认单测](../../test-results/m22-evidence/qa-unit.log) · [fuzz 原始计数](../../test-results/m22-evidence/qa-fuzz-verbose.log) · [计数与超时](../../test-results/m22-evidence/qa-fuzz-summary.json)

默认夹具检查通过 24 项。PyMuPDF 1.26.7 对 66 次填充、213 个有墨迹控件进行四倍渲染，边缘裁切和映射框外变化均为 0。其中两份 M22 条件 PDF 涵盖八个控件，验证了阿语横幅、清空文字、勾选与取消勾选的活动外观。既有合并打印的 16 页和压平 ZIP 的 8 页逐像素一致。[夹具命令](../../test-results/m22-evidence/qa-fixtures.log) · [逐控件报告](../../test-results/m22-evidence/qa-pixel-output/manifest-verification.json) · [四倍渲染日志](../../test-results/m22-evidence/qa-pixels-native.log)

主执行端在同一提交补入上版使用的四份公开模板和 Source Serif CFF 字体。按原 SHA-256 核对输入后，原有 69 组和新增 2 组共 71 组全部通过，四倍裁字和框外变化仍均为 0。三份公开模板保持原验收结果，含 XFA 的 IRS W-9 继续在读取表单前被拒绝。[输入、样本身份与结果](../../test-results/m22-evidence/lead-pixels-prior-inputs.json) · [71 组原始渲染报告](../../test-results/m22-evidence/lead-pixel-output-with-prior-inputs/manifest-verification.json)

默认来源、严格来源 `https://release.arabiform.test`、恢复默认后的三次正式构建和发布核验均通过。五个静态路由的最大入口为 269,489 字节，gzip 为 83,934 字节，低于 274,000 / 85,800 字节预算。核验覆盖 sitemap、响应头、许可证声明和 CI。严格检查对仍含 `arabiform.example` 的默认构建返回 1。正式核验仅使用本机静态产物。[默认](../../test-results/m22-evidence/qa-release.log) · [严格来源](../../test-results/m22-evidence/qa-strict-release.log) · [占位域名拒绝](../../test-results/m22-evidence/qa-strict-stale.log) · [恢复默认](../../test-results/m22-evidence/qa-default-release.log)

受限 Windows 环境首次运行像素检查及 CLI 时，tsx 在读取系统用户信息时返回 `uv_os_get_passwd ENOMEM`。保留启动日志后，在获准的本机环境以相同冻结提交、D 盘输入和临时目录重跑。开发期间另复现 GBK 标准输出无法编码阿拉伯数字。修正报告流后，GBK 和 UTF-8 都能输出完整 M22 汇总。[受限像素启动](../../test-results/m22-evidence/qa-pixels.log) · [受限 CLI 启动](../../test-results/m22-evidence/qa-cli-normal.log) · [GBK 复跑](../../test-results/m22-evidence/worker-a/pixels-gbk-replay.log)

夹具属性文件保留基线 Git 对象 `16687c743d52cd6832cb834023e0b8160b38bf1e`。锁文件依赖未变，条件引擎扫描未发现求值、DOM 或外部 I/O 调用。既有 RTL 扩展名标准已关联本次 Edge 字形坐标检查。[受保护文件与引擎核对](../../test-results/m22-evidence/lead-core-invariants.json) · [代码标准](../code-standards.md)
