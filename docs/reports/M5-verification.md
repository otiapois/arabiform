# ArabiForm M5-RC 独立验收

**M5-RC 通过本地验收。** 英文和阿语界面提前显示文件名调整原因，下载的 ZIP、JSON 和 CSV 与队列文件名逐项一致。最终主线的真实 Edge 测试 **42/42** 通过，保留 M1–M4 的 38 项，四项新增场景覆盖两种语种和两个视口。修正了阿语首页过早加载 PDF 字体数据的问题。最终入口为 **285,213 B / gzip 89,542 B**。

## 验收版本

2026-11-27，QA 在主工作区的 `main` 提交 `079e4bd2217663bf51d243c3b05d65256aefbe56` 完成七项检查。虽然 42 项 Edge 均通过，逐项查看桌面与移动的实际请求后发现，阿语页在选文件前已加载用于 PDF 的嵌入字体 JS。修正仅涉及三个界面文件，另在既有 M5 用例中补入空载断言。最终主线 `8800f147fd6e6664d71bd7a61d34eadde5a92276` 复跑类型检查、构建和完整 Edge。单元测试、模糊测试、夹具与 PDF 像素校验引用首轮同一核心代码的收据。[本轮需求](../tasks/M5-rc-a11y-bundle-and-5k-fuzz.md) · [Edge 用例](../../tests/e2e/m5-rc.spec.ts)

| 主线命令 | 核验结果 |
|---|---|
| `npm run typecheck` | TypeScript 通过，包含新浏览器用例。 |
| `npm test` | 8 个文件、48 项全部通过。 |
| `npm run test:fuzz` | 固定种子 `0x4a216d32`，12 项属性全部通过。各属性断言实际接受数等于指定次数且丢弃数为 0，共 5,060 个案例。相较 M4 增加 720 组文件名及 240 组混排选项／自定义字体案例。[属性与次数](../../tests/core/fuzz.test.ts) |
| `npm run generate:fixtures -- --check` | 23 个合成夹具逐字节一致，继续使用现有 PDF。 |
| `npm run verify:pixels` | pdf-lib 核验 26 次填充及 4 类拒绝保护。PyMuPDF 1.26.7 在 4 倍分辨率下检查 87 个有墨迹控件，边界裁切 0 像素，映射控件外变化 0 像素，最小边距为 6 个渲染像素。17 张合并页、8 张压平 ZIP 页与可编辑页逐像素一致。 |
| `npm run build` | 284 个模块、5 个静态 HTML、一个 HTML 声明的 JS 入口。最终入口 `/assets/index-BLjm3NDx.js` 为 **285,213 B**，gzip **89,542 B**，低于 300,000 / 95,000 B 预算。Vite 提示部分按需分包在 minify 后、gzip 前仍大于 500 kB。 |
| `npm run test:e2e` | 两轮主线各 42/42，最终 5.2 分钟，单执行者、零重试。1440 × 900 桌面与 390 × 844 触屏模拟各 21 项。最终 42 份运行记录共 692 个本地请求，外部请求、WebSocket、控制台／运行时错误、HTTP 错误与 PDF.js 假工作线程回退均为 0。用例结束后 `127.0.0.1:4187` 拒绝新连接。 |

## 下载前预览与实际导出

QA 在英文 `/` 和阿语 `/ar/pdf-mail-merge` 各自上传同一份 AcroForm PDF 与五行 CSV。输入的 `Record` 列决定文件名。四种语种与视口组合都在下载前展开了调整原因，再解开实际 ZIP。队列、ZIP 条目、JSON 与 CSV 均按顺序返回下表中的完整名称。[测试使用的 PDF](../../fixtures/golden/template.pdf)

| CSV 原文 | 队列、ZIP 与审计文件名 | 展开标记所得原因 |
|---|---|---|
| `../عقد` | `عقد.pdf` | 移除不适用于文件名的字符 |
| `CON` | `_CON.pdf` | Windows 保留名 |
| `Batch` | `Batch.pdf` | 保留原名，无标记 |
| `batch` | `batch-2.pdf` | 与第三行仅大小写不同 |
| `Ｂａｔｃｈ` | `Ｂａｔｃｈ-3.pdf` | 全角字母经 NFKC 归一化后与前两项重名 |

四次实际下载均用 fflate 解包。每个 JSON 行对象和 CSV 表头都只包含既有的 `rowNumber`、`filename`、`status`、`diagnostics`、`fontSizes`。行级原因在界面中按所选语种显示。Lead 另外对照了 M4 与 M5 生成的 2,000 个文件名，名称逐项一致。

## 键盘、RTL 与界面

- 焦点位于队列过滤按钮时，`/` 进入搜索框。在搜索框与行内文本框里键入同一字符，控件保留字符。切换名单后，批次阶段和总数／就绪数均通过 `aria-live="polite"` 提供。这里验证了浏览器 DOM 和键盘行为。
- 第二行先将姓名从 `Hana` 改为 `Noor`，点击完成，再将它临时改为 `Temp/`。按 `Escape` 后编辑器关闭，焦点回到第 2 行的 `Edit row 2` 或 `عدّل الصف 2`。重开编辑器、回读下载的 `_CON.pdf`，两处均是 `Noor`。四次实测的键盘焦点轮廓为 2 px 实线，ZIP 复选框与标签的实际间距为 10.39 px。
- 三张截图已分别打开核对。桌面显示全部五行和双语下载按钮。移动 RTL 图中第二行展开本地化的 Windows 保留名说明，操作区可见。针对搜索、编辑、导出前后的页面宽度断言均通过。[英文桌面](screenshots/m5/desktop-m5-collision-badges.png) · [阿语桌面](screenshots/m5/desktop-m5-ar-rtl-rc.png) · [阿语移动](screenshots/m5/mobile-m5-rc.png)

最终全套只重录三张 M5 图。与首轮对照，文件名文字所在区域的像素发生变化，英文桌面 2,285 个、阿语桌面 2,608 个、阿语移动 2,579 个。图像尺寸保持一致，四枚调整标记及第二行展开的原因在各图中均清晰可见。

## 构建、证据与适用范围

主线五个静态入口均含各自的标题、描述、FAQPage 与 SoftwareApplication JSON-LD。构建头包含 `connect-src 'none'`、`worker-src 'self'`、`form-action 'none'`。首次实测，`/ar/pdf-mail-merge` 空载时请求了 786.64 kB 的本地 `fonts-*.js`（gzip 369.04 kB）。同次运行的英文首页只请求入口 JS 与 CSS。修正后，阿语界面通过 CSS 使用已有的本地 TTF，预检才动态导入 PDF 字体字节。原有 CI 配置、依赖锁及第三方声明已核对。[字体资源实现](../../src/web/resources.ts) · [静态与 CSP 用例](../../tests/e2e/seo.spec.ts) · [CI](../../.github/workflows/ci.yml) · [第三方声明](../../THIRD_PARTY_NOTICES.md)

最终两个视口的空载请求明细相同。英文首页只加载入口 JS 和 CSS，阿语首页额外读取 `/fonts/NotoNaskhArabic-Regular.ttf`、`/fonts/NotoSans-Regular.ttf`。两个语种在上传前均未请求 PDF 字体 JS、PDF 引擎、预览或工作线程。上传后四个 M5 场景均观测到实际的 PDF 字体 JS 请求。

4 份在本机保留的公开空白表均通过固定 SHA-256、页数及相应结构检查。三份普通 AcroForm 覆盖 USPTO SB/01、法院 AO440、USCIS I-9。IRS W-9 的 XFA 拒绝路径及 Adobe Source Serif 4 自定义 CFF 路径均参与像素验收。复验时将 `ARABIFORM_PUBLIC_TEMPLATES` 指向 `test-results/m3-evidence/inputs`，将 `ARABIFORM_CUSTOM_CFF_FONT` 指向该目录中的 `SourceSerif4-Regular.otf`。[公开模板校验](../../scripts/verify-public-templates.mjs) · [像素校验](../../scripts/verify-pdf-pixels.ts)

Windows 沙箱首次在 tsx 命名临时目录时返回 `uv_os_get_passwd ENOMEM`，测试脚本尚未启动。在获准的本机范围用相同主线、D 盘输入和临时目录复跑原命令后，获得本报告所列像素结果。原始错误和成功记录均已保留。[经验记录](../../LESSONS.md) · [代码标准](../code-standards.md)

本机原始证据保存在项目的 `test-results/m5-evidence/`。`gates.json` 和 `main-edge/` 对应首轮七项检查及每个场景的请求记录，`pixel-verification.json` 提供逐控件测量。`final/` 保存修正后的类型、构建和完整浏览器收据，包含 M5 实际上传的 CSV、下载的 ZIP 和两种审计文件。最终构建的 28 个文件内容指纹为 `4303760fd8503c7c60bbef7ec59e675c7d676a5972618d92cbb2bb7b0fff120f`。

环境为 Windows、Microsoft Edge 124.0.2478.80、Playwright 1.65.1、Node.js 24.22.1、Python 3.13.11。移动端使用 Edge 触屏模拟。本次覆盖本地浏览器和构建产物，真机、读屏器朗读、实体打印、线上部署与远端 CI 均未实测。
