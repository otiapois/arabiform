# ArabiForm M4 独立验收

修正后的 `main` 通过 **38/38 项真实 Edge 验收**，其中 32 项为原有场景。桌面和移动分别用英文 CSV、阿语 XLSX 修正第 2 页错误，再对照可编辑与压平 ZIP 中的 12 份双页 PDF。**24/24 页**在 PyMuPDF 4 倍渲染下逐像素相同，压平版中剩余交互控件为零。此前发现的审计格式回归已修正。此次验收覆盖本地构建。

## 验收版本与环境

2026-11-27，独立 QA 首先使用 A、B、C 合并后的生产代码 `357fc6cea33d8f52dece4bc891c5cda412895e0b`。提交 `05d8a9e7ef368813536c76ba54cb9356bdd08fcc` 添加浏览器测试和三张截图。最终生产代码取自 `main` 的 `c2664b1d6839e7f6faad8a5ecfff7e5de532014a`。此前 32 项 Edge 场景及其共同使用的下载校验文件均与 M3 基线 `1cfddc4` 相同。

Windows 本机安装的 Microsoft Edge 124.0.2478.80、Playwright 1.65.1、Node.js 24.22.1、Python 3.13.11、PyMuPDF 1.26.7。桌面为 1440 × 900，移动为 390 × 844 的 Edge 触屏模拟，两种视口的 DPR 均为 1。上传、预览与下载针对在回环端口提供的生产构建。[浏览器配置](../../playwright.config.ts) · [流量和错误监测](../../tests/e2e/browser.ts)

| 项目根目录命令 | 测得结果 |
|---|---|
| `npm run typecheck` | 通过，含新增 Playwright 用例和下载字节校验。 |
| `npm test` | 初轮 8 个测试文件、44 项通过。补入审计序列化回归后，最终 `main` 上 45 项全部通过。M3 基线为 32 项。 |
| `npm run test:fuzz` | 固定种子 `0x4a216d32`，10 项属性、4,100 例通过。M3 的 2,560 例之外，增加 1,000 组选项冲突、300 次下拉框与单选组写入、240 个打印 ZIP 案例。[各属性的实际运行次数](../../tests/core/fuzz.test.ts) |
| `npm run generate:fixtures -- --check` | 23 个合成文件逐字节一致。 |
| `npm run verify:pixels`，默认 CI 输入 | 21 次填充，76 个有墨迹的控件，16 张合并页和 8 张压平 ZIP 页与可编辑页的 4 倍渲染逐像素相同。0 裁切，0 控件外像素变化。 |
| 同一命令，加入公开模板及 CFF 字体 | 26 次填充，87 个有墨迹的控件，17 张合并页及 8 张压平 ZIP 页逐像素相同。0 裁切，0 控件外变化，墨迹距控件边缘最小为 6 个渲染像素。 |
| `npm run build` | 284 个模块，5 个 HTML 文件。Vite 提示部分分包经 minify、未 gzip 的大小超过 500 kB。 |
| `npm run test:e2e` | 修正后的 `main`，桌面 19 项、移动 19 项，38/38 通过，单执行进程，零重试，4.4 分钟。完整测试前后 28 个静态文件的内容一致。退出后 `127.0.0.1:4187` 拒绝新连接。 |

公开空白表均与登记的页数和 SHA-256 匹配。USPTO SB/01、美国联邦法院 AO 440、USCIS I-9 完成填充。IRS W-9 含 XFA，按预期返回 `xfa-unsupported`。额外的 CFF 字体为 Adobe Source Serif 4，SHA-256 为 `edf160d0d584deee8a3bb2c3371b2a7624ca63580fbe02c57c1f4c91e84d8787`。两轮渲染使用同一 M4 模板，SHA-256 为 `d44958dc60c4c9aa35386b3d80572151249688a6e9ffdeac8521e83e84a887d1`。从文件哈希、两页静态标题裁图和真实浏览器截图核对了修正后的样本。[公开表登记](../../scripts/verify-public-templates.mjs) · [模板和名单](../../fixtures/m4) · [像素校验](../../scripts/verify-pdf-pixels.py)

五个实际构建入口为 `/`、`/arabic-pdf-form-filler`、`/ar/pdf-mail-merge`、`/preserve-leading-zeros-pdf`、`/privacy-and-proof`。逐路由检查标题、描述、canonical、SoftwareApplication 与 FAQPage JSON-LD。英语页 `en/ltr`，阿语页 `ar/rtl`。预渲染 HTML 及载入后的页面均有零个具名表单。sitemap 列出同五条 canonical，robots 指向 sitemap。实际响应头包含 `connect-src 'none'`、`worker-src 'self'`、`form-action 'none'`。在专门的浏览器上下文发起的同源连接被 CSP 拒绝。[静态与浏览器校验](../../tests/e2e/seo.spec.ts)

38 份运行记录共观测到 606 个本地 HTTP 请求。外部请求、WebSocket、控制台/运行时错误、HTTP 错误和 PDF.js 假工作线程回退均为零。英文和阿语在两种视口中均实测无页面横向溢出。Lead 的另一次初跑曾在阿语入口收到 404，当时主工作区的构建文件也被改写，触发者未能确认。最终全套串行测试中没有复现，测试前后 28 个文件的 SHA-256 和修改时间一致，完整构建指纹为 `ae537e3eba9ca19ffd58cd0b3dd065c86ec33deea36a4868bf26880562be816d`。

## 跨页修复与实际下载

在桌面和移动视口分别加载英文页的合成 CSV、阿语 RTL 页的同内容 XLSX。每次从文件选择框读入真实两页 PDF。姓名与复选框按表头匹配，Clinic、Contact 默认留空。显式映射两者后，3 行中有 2 行可导出，第一行的 `Unknown Clinic` 触发第 2 页诊断。[浏览器用例](../../tests/e2e/m4-choices.spec.ts)

| 正常用户操作 | 每个语种与视口组合的证据 |
|---|---|
| 从第 1 页选择错误行 | 实际渲染第 2 页，页码显示 2/2，只有 Clinic 带红框。用模板原始控件坐标独立计算红框位置和尺寸。手动返回第 1 页后红框消失。点击带 1 个问题的第 2 页按钮，PDF.js 再次呈现相同画布。 |
| 在选中行内改选 `RIY` | 下拉菜单列出 `عِيَادَةُ الرِّيَاضِ · RIY` 和 `Jeddah Clinic · JED`。一次选择后三行均为 Ready。页码保持 2/2，错误提示、问题页按钮和红框消失，新画布显示阿语标签。 |
| 分别下载默认 ZIP、勾选压平后的 ZIP | 每包 3 份双页 PDF。Clinic 的导出值依次为 `RIY / RIY / JED`，外观流中的标签为两个利雅得阿语标签及一个 Jeddah Clinic。Contact 的逻辑选择是 `CALL / MAIL / CALL`，三行底层字段值依次为 `/0`、`/1`、`/0`，两枚单选按钮的活动状态逐项正确。未映射的 PreservedClinic、PreservedContact、Sentinel 保留原始字段值、控件状态、外观引用和外观流字节。两页上的姓名与第 1 页的复选框也已核验。 |
| 核对压平版 | 从浏览器下载事件取得两份 ZIP。PyMuPDF 在 4 倍分辨率对同一行的两份 PDF 逐页比较，6/6 页完全相同。每份压平 PDF 的 AcroForm 和所有交互控件均已移除，页内图片数量与可编辑版相同。四组浏览器操作累计对照 24 页，来自同一份双页模板的三个案例。 |
| 预设往返 | 桌面与移动分别核对下载的 v2 JSON，包含两项选择映射与布尔值 `flattenZip: true`。清空选择和开关后重新导入，原映射与开关恢复。导入 M3 格式的 v1 后，可编辑 ZIP 恢复，两个选择保持空白。再次导出的 JSON 与旧结构逐项相同。 |

[下载字节与独立清单](../../tests/e2e/choices-downloads.ts) · [桌面跳到错误页](screenshots/m4/desktop-m4-multipage-jump.png) · [桌面修正后的阿语选项](screenshots/m4/desktop-m4-choices-ready.png) · [移动阿语 RTL](screenshots/m4/mobile-m4-choices.png)

## 审计兼容与打印失败

初次全套在独立 QA 工作树得到 34/38。桌面与移动各有两次上传（CSV、XLSX）因同一条断言失败。原始第 5 行的 `Name` 仍正确报告 `too-narrow` 和 `widgetIndex: 0`，下载的 JSON 却多出预览内部使用的 `pageNumbers: [1]`。审计 CSV 与 JSON 共用同一诊断对象。原始错误、运行记录和四份下载 JSON 均已按场景保存。修正仅在审计序列化时剔除导航页码，核心和工作线程继续传递页码，`invalid-choice` 继续包含合法选项。新增核心回归还核对标签及导出值，原有浏览器断言保持完整。[导出实现](../../src/core/pdf/exports.ts) · [兼容回归](../../tests/core/pdf.test.ts) · [旧下载用例](../../tests/e2e/downloads.ts)

独立 QA 从修正后的 `main` 先单跑这四项，4/4 通过，用时 1.3 分钟。四个下载目录中，JSON 及 CSV 解码后的第 5 行诊断均为 `[{"field":"Name","widgetIndex":0,"code":"too-narrow"}]`。随后检查 4187 已拒绝连接，再在同一个构建上启动全套。

Lead 另行回放 M3 旧打印路径。缺少 `/AP` 且 `/V` 为数组的下拉框压平后改变 86,832 个像素。已勾选但缺少 `/AS` 的复选框改变 350 个像素。新版对此两例的合并打印和压平 ZIP 均返回 `unflattenable-widget`，可编辑 ZIP 保留成员原始字节。Lead 还从 `357fc6c` 的英文桌面页与阿语移动页分别验证打印失败的界面提示，以及关闭压平后成功下载可编辑 ZIP。[已纳入本次独立全套的回归](../../tests/core/choices.test.ts) · [经验记录](../../LESSONS.md)

本次结论适用于本地 Edge、PDF.js 和上述 PyMuPDF 版本及输入。Adobe 一项验证了 CFF 字体文件。Acrobat、iOS 真机、macOS Preview、WhatsApp、实体打印机、线上 Cloudflare 及远端 CI 均未实测。

## 主线交付

主线生产提交 `c2664b1d6839e7f6faad8a5ecfff7e5de532014a` 通过类型检查、45 项单元与集成测试、4,100 个固定种子用例、23 个合成夹具字节检查、包含公开输入的 4 倍像素校验及生产构建。独立 QA 在同一主线构建上完成 38 项 Edge 测试。验收发现的阻断问题均已修复复验。本轮经验已记录，新增或更新条目的 Seen 为 1 或 2。[经验记录](../../LESSONS.md)

主线复跑后仅合入验收报告和经验记录。与 M4 起点 `a8def94` 对照，之前的浏览器用例、夹具、截图、验收报告、CI 配置、锁文件及第三方声明全部一致。三张 M4 截图已逐图核验并核对文件尺寸。四个临时工作树及 `.arabiform-wt` 已删除，Git 只登记主工作树。4187、4191、4193、4195 均拒绝新的回环连接。

主工作区的 `test-results/m4-evidence/` 保留初轮审计失败记录、最终 Edge 运行日志与逐场景收据、打印回读、像素清单及前后构建指纹。可从项目根目录运行本报告的命令复验。加验四份公开空白表及 Source Serif 4 OTF 时，将 `ARABIFORM_PUBLIC_TEMPLATES` 指向本地 `test-results/m3-evidence/inputs`，将 `ARABIFORM_CUSTOM_CFF_FONT` 指向其中的 `SourceSerif4-Regular.otf`。常规 CI 直接使用仓库内的合成夹具。
