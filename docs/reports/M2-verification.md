# ArabiForm M2 独立验收

2026-11-26，独立 QA 在 Windows 系统 Edge 跑完 **22/22** 项，包括全部 12 项 M1 场景。200 行名单在桌面视口用 **19.509 秒**完成预检，移动视口为 **20.563 秒**。两个实际下载的 ZIP 各有 200 份单页 PDF，逐份读回的姓名和五位文本编号均与名单一致。4 倍像素测试得到 **0 个裁切像素、0 个字段外变动像素**。此次覆盖内没有待修的 P0/P1。

## 版本与证据范围

| 对象 | 独立验收使用的版本 |
|---|---|
| M1 已验收基线 | `e6094dc`（`v0.1.0`） |
| A、B、C 合并后的 main | `b21a0254ea04438e48493ea953f9cddb95e5ecdf` |
| QA 正式复跑基线 | `9722b07ff83c8b49b0a0d84299d1ed3c9da23659`，含预览自动退出修复 `b420ac8` 与像素清单兼容修复 |
| 新增浏览器断言与四张截图 | `2a0b4ab7076a8fdfd18e82123ee8944127d94aa3`，保留原有 M1 用例与下载校验 |
| 本地机器 | Windows 10.0.22631，Intel Core i5-9300H，8 个逻辑处理器，32 GiB 内存 |
| 工具 | Node.js 24.22.1、npm 11.11.0、Python 3.13.11、PyMuPDF 1.26.7、Playwright 1.65.1、Microsoft Edge 124.0.2478.80 |
| 浏览器运行方式 | 单个 Playwright 执行进程，桌面 1440 × 900，移动触控视口模拟 390 × 844，DPR 1。使用本地生产构建、真实响应头和浏览器文件输入 |

## 200 行实测

采用 200 行合成 HR 名单、四个循环使用的阿语姓名和互异的文本编号 `00001` 至 `00200`。预检起点为选择名单文件前，终点为界面显示 200 行就绪。搜索计时从自动化输入到匹配第 181 行并再次读到活动进度，包含浏览器和自动化的往返。ZIP 计时包含点击、浏览器生成和保存文件。两种视口各运行一次，未采集 FPS、内存峰值或真实移动设备数据。[用例](../../tests/e2e/m2-batch.spec.ts) · [HR 模板](../../fixtures/m2/hr-onboarding.pdf)

| 该次观测 | 桌面 Edge | 移动视口 Edge |
|---|---:|---:|
| 名单选择至 200 行就绪 | 19.509 s | 20.563 s |
| 活动预检期间搜索并看到匹配行 | 52 ms | 53 ms |
| 点击导出至 200 份 PDF 的 ZIP 保存完成 | 804 ms | 827 ms |
| 名单选择至 ZIP 保存完成（含界面操作及截图） | 20.683 s | 22.604 s |
| ZIP 文件字节数 | 66,062,508 | 66,062,508 |
| 逐份复核页数、姓名与编号 | 200/200 | 200/200 |

两次搜索输入前后都读到 `preflight 1/200`，列表仅显示第 181 行，随后可以清空搜索并翻页。每页 20 行，第 2 页从第 21 行开始。行号、文件名、单元格值三种搜索均通过，四种状态筛选验证了本批次的匹配数。Edge 实际启动同源编译产物 `batch.worker-*.js`，另行启动 `pdf.worker.min-*.mjs` 渲染预览。

桌面与移动端均在预检 1/200 后点击取消，观察到该 Worker 的实际关闭事件及界面取消状态。恢复后再次观察到独立 Worker 开始处理 200 行，再以仅含 `00999` 的名单替换，第二个 Worker 关闭。重导出的 ZIP 只含 `00999-Mona.pdf`，字段值一致。对已就绪的 200 行另行启动合并导出，分别在进度读到 10/200 和 12/200 后取消，两次都关闭 Worker、禁止导出，未触发下载。

## 用户操作与证据

| 场景 | 结果 |
|---|---|
| 旋转访客证 | `Name` 在预览红框和所选行均显示需要 7.58 pt、当前下限 8 pt。单击建议按钮后减小 0.42 pt，1 行通过，红框清除。浏览器实际下载的 PDF 保留完整 `سَلْمَى بِنْت يَاسِين / AR-00042` 和 `00007`。另测 10 位文本填入 `MaxLen=4`，两处均提示多出 6 个字符，界面禁止导出。 |
| 本地预设 | 导出的 JSON 只包含版本、字段映射、文件名模板、字号下限和字体模式。改变映射并重新导入后，`Start Date → Employee ID`、`{{Job}}.pdf`、9.25 pt、Latin 字体都恢复。版本 2 被拒绝，缺失字段 `RetiredField` 可见且跳过。检查 cookies、localStorage、IndexedDB、sessionStorage、Cache Storage 均为空，刷新后名单与设置恢复初始状态。 |
| 文件名 | 两种语言的混排名称均使用 `<bdi dir="auto">`。来自目录分隔符和设备名称的九个实际下载成员名与预期逐个相等，含三个 `note` 同名的递增后缀及带下划线的设备名，其 PDF 内编号仍正确。 |
| 保留 M1 行为 | 桌面与移动端都上传真实 CSV、XLSX，从预览红框操作到编辑通过并下载。八套下载清单共复核 36 份单页、144 个填入字段与 36 张合并页，原始值、未映射字段及合并图像均通过。拒绝替换时清空旧模板并禁用导出。 |
| 路由、网络及页面宽度 | 直接访问 `/`、`/arabic-pdf-form-filler`、`/ar/pdf-mail-merge`、`/preserve-leading-zeros-pdf`、`/privacy-and-proof`。实际响应均含 `connect-src 'none'`、`worker-src 'self'`、`form-action 'none'`，两种视口各用独立探针证实同源 fetch 被阻止。英阿介绍页的原始 HTML 和可见页面均有同一合成示例及墨迹边界说明。22 份运行日志合计 342 次同源 HTTP 请求、40 个批处理及 64 个 PDF.js Worker，0 个外部请求、WebSocket、控制台或页面错误。桌面和移动端测量的整页宽度分别等于 1440 和 390 像素。 |

四张截图采自上述 Edge 场景，已逐张打开复核。访客证截图保留实际红框及字号，队列截图分别显示 200 行完成后的状态和阿语样本的混排文件名。

| 桌面 1440 × 900 | 移动视口 390 × 844 |
|---|---|
| [访客证红框与 7.58 pt 诊断](screenshots/m2/desktop-m2-flagged-delta.png) · [200 行队列](screenshots/m2/desktop-m2-200row-queue.png) · [阿语 RTL 队列](screenshots/m2/desktop-m2-ar-rtl.png) | [200 行队列](screenshots/m2/mobile-m2-queue.png) |

## PDF、模糊测试与标准审查

固定种子 `1243704626` 生成 320 例 CSV、200 例损坏或非预期名单数据、360 例文件名与审计导出组合、280 例实际 AcroForm 填写，共 1,160 例，丢弃 0 例、未捕获异常 0 个。280 次 PDF 填写中，77 次生成并逐字形校验，203 次给出诊断并禁写 PDF。四个钉住 SHA-256 的公开空白模板均已独立核对，其中 USPTO SB/01、AO 440、USCIS I-9 进入填表验证，IRS W-9 因原始 XFA 层被拒绝。[种子与断言](../../tests/core/fuzz.test.ts) · [公开模板哈希](../../scripts/verify-public-templates.mjs)

| 代码标准 | 本次审查 |
|---|---|
| 读取表单前检查 XFA、加密和签名 | 审查原始字典与 trailer 的读取顺序。四类拒绝夹具及真实 W-9 分类均符合预期。 |
| 按真实墨迹边界安置文字 | 4 倍渲染共 18 次填充、59 个带墨迹的控件，最小边缘间距为 6 个渲染像素，0 裁切、0 字段外差异，5 张合并页逐像素相同。包含全部 8 张新合成模板。 |
| 同一字段的多控件原子性 | 不同方向、不同尺寸的重复控件分别验算。一处放不下时整行不给 PDF，三页调度单的可用输入则生成完整输出。 |
| 保留文本前导零 | CSV/XLSX 真实导出和两份 200 行 ZIP 都按字符串读回编号。Excel 数值及科学计数法警告仍可见。 |
| 未映射字段保持原样 | 对比 `KEEP 00109` 的原始 `/V`、`/AP`、正常外观流字节，并在像素图中检查字段外区域。 |
| 运行时零外发 | 已构建站点的字体、样本与两类 Worker 留在本地。原始响应、独立 CSP 阻断探针及页面运行日志三者一致。 |
| 同类输入和输出路径 | CSV、XLSX、ZIP、合并 PDF、CSV/JSON 审计、英阿页面均复跑，预检与合并导出两类取消路径分别有运行证据。 |
| 真实环境由红到绿 | 基线字形顺序、MaxLen 和导出回归有对应断言。QA 首跑 16/22，四个旧用例暴露像素校验器的 `before.pdf` 命名回归。另两项由测试误删模板必填姓名映射造成，改测可选字段后保留了完整往返验证。修正后 22/22。 |
| 测试结束释放预览监听 | 同一产物服务器向 Edge 提供响应，Playwright 显式关闭所持句柄。正式套件退出码 0，随后探测 127.0.0.1:4187 返回 `ECONNREFUSED`，无需人工结束进程。 |

回归缘由与三次预览监听残留的来源记录见[实际教训](../../LESSONS.md)。新增直接依赖 `fast-check@4.3.0` 与其传递依赖 `pure-rand@7.0.1` 的许可均已登记，CI 配置含独立模糊测试步骤。[代码标准](../code-standards.md) · [依赖许可](../../THIRD_PARTY_NOTICES.md) · [CI 配置](../../.github/workflows/ci.yml)

## 复跑

使用锁文件对应的 D 盘依赖与系统 Edge。在项目根目录执行下列 PowerShell 命令。将 `ARABIFORM_PUBLIC_TEMPLATES` 指向已按上述 SHA-256 核对的四个空白表目录，才能复现全部 18 次填充。临时文件、npm 缓存及运行结果均位于 D 盘。M2 截图仅在显式设置捕获变量时写入。

```powershell
$qaRoot = 'D:\workspace\vibe_coding\sites\.arabiform-wt'
$env:TEMP = Join-Path $qaRoot 'tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $qaRoot 'npm-cache'
$env:ARABIFORM_PUBLIC_TEMPLATES = Join-Path $qaRoot 'templates'
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$env:ARABIFORM_E2E_PORT = '4187'
$env:ARABIFORM_CAPTURE_SCREENSHOTS = '0'
$env:ARABIFORM_CAPTURE_M2_SCREENSHOTS = '1'
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
$npm = 'C:\Program Files\nodejs\npm.cmd'
node scripts/verify-public-templates.mjs $env:ARABIFORM_PUBLIC_TEMPLATES
& $npm run typecheck
& $npm test
& $npm run test:fuzz
& $npm run generate:fixtures -- --check
& $npm run verify:pixels
& $npm run build
& $npm run test:e2e
```

上述七条 npm 命令均返回 0。Vitest 23/23（含四项模糊测试），17 个跟踪夹具重新生成后逐字节相同，构建产出 5 个静态 HTML，Edge 22/22（约 2.2 分钟）。附加运行 `npm run test:fuzz -- --reporter=verbose --disableConsoleIntercept` 可看到实际通过与标记数。Windows 沙箱内首次像素命令在 tsx 查询用户信息时收到 `uv_os_get_passwd ENOMEM`，同一命令在批准的本机范围内用同组 D 盘输入通过。

每次复跑会在忽略目录 `test-results/e2e/<场景>/` 写入网络日志 `runtime.json`、计时 `batch-200.json` 或取消记录 `cancellation.json`。浏览器下载与逐页比对在同一场景目录，核心 4 倍像素明细在 `test-results/pdf-pixels/manifest-verification.json`。Vite 提示部分字体及 PDF 模块超过 500 kB。证据范围限于此次模板、已安装的 Edge 和两个视口。尚未验证移动真机、物理打印、阿语母语校订、远端 CI 或生产域名。此次验收未发布站点。
