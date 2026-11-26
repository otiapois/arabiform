# ArabiForm M3 独立验收

2026-11-27，独立 QA 在合并后的生产构建上完成 **32/32 项 Edge 验收**。原有 22 项全部通过，新增 10 项覆盖混合表单、Excel 公式、本地字体与文件名排版。完整像素套件验证 22 次填充、69 个有墨迹的控件和 9 张合并页，得到 **0 个裁切像素、0 个字段外变化像素**。文件名在两个语种、两种视口的队列与所选行共 16 次测量中，`.pdf` 均准确贴合右缘。此次覆盖范围内没有待修的 P0、P1 或 P2。尚未部署。

## 独立运行范围

生产代码基于 A、B、C 合并后的 `aa7c84b98262c7d272a8a816664271ae5868ba0a`。QA 增加断言和五张截图的提交为 `f4e03a10e1f6488d426b5a0b89276436d1927e68`。使用 Windows、Node.js 24.22.1、Python 3.13.11、PyMuPDF 1.26.7、Playwright 1.65.1 和系统 Microsoft Edge 124.0.2478.80。移动场景是 Edge 的 390 × 844 触屏模拟，桌面为 1440 × 900，两者 DPR 均为 1。

| 从项目根目录执行 | 本次结果 |
|---|---|
| `npm run typecheck` | 通过，包括新加的浏览器测试和 PDF 读取代码 |
| `npm test` | 6 个文件、32 项通过，M2 基线 23 项 |
| `npm run test:fuzz` | 固定种子 `0x4a216d32`，7 项属性、2,560 例全部完成。名单往返 320、异常名单 200、文件名与审计 360、PDF 写入与字形几何 280、损坏字体 460、复选框输入 520、缺字字体 420。[各项运行次数和断言](../../tests/core/fuzz.test.ts) |
| `npm run generate:fixtures -- --check` | 20 个合成文件逐字节一致 |
| `npm run verify:pixels`，默认 CI 输入 | 17 次填充、58 个有墨迹的控件、8 张逐像素相同的合并页。0 裁切，0 字段外变化 |
| 同一命令，加入官方模板与 CFF 字体 | 22 次填充、69 个有墨迹的控件、9 张逐像素相同的合并页。0 裁切，0 字段外变化。4 倍渲染下，墨迹距控件边缘最小为 6 像素 |
| `npm run build` | 生产构建通过，5 条静态路由，281 个模块。Vite 提示部分产物超过 500 kB |
| `npm run test:e2e` | 单执行进程、0 重试，32 项通过，用时约 4 分钟。退出后 `127.0.0.1:4187` 拒绝新连接。桌面混合表单截图随后单独重拍，使用独立的输出目录，同案再次通过，端口再次释放 |

四份官方空白表均通过登记的 SHA-256 及页数校验。USPTO SB/01、美国联邦法院 AO 440 和 USCIS I‑9 进入填充验收。含 XFA 的 IRS W‑9 按预期拒绝；另测加密表、已签名字段和无控件平面 PDF。Adobe Source Serif 4.005R 的 `SourceSerif4-Regular.otf` SHA-256 为 `edf160d0d584deee8a3bb2c3371b2a7624ca63580fbe02c57c1f4c91e84d8787`。本次 CFF 核心渲染通过，PyMuPDF 无字体回退警告。[官方模板与哈希](../../scripts/verify-public-templates.mjs) · [完整 PDF 验证入口](../../scripts/verify-pdf-pixels.ts)

## 真实浏览器下载

桌面与移动场景均通过浏览器的文件选择控件加载诊所 PDF、CSV、XLSX 和 TTF。QA 从下载事件保存 ZIP 和合并 PDF，解包后分别使用 PDF-lib 和 PyMuPDF 核验。[浏览器场景](../../tests/e2e/m3-pro.spec.ts) · [下载文件检查](../../tests/e2e/clinic-downloads.ts) · [4 倍像素对照](../../scripts/verify-pdf-pixels.py)

| 场景 | 两种视口分别得到的结果 |
|---|---|
| 同意书映射 | 原名单中的 `نعم` 勾选两处 Consent，`لا` 清空两处，`review` 显示明确的 Consent 诊断。修改前 ZIP 仅含 2 个合格成员。第 3 行内联改为 `نعم` 后，界面显示 3 行 Ready，ZIP 增至 3 个成员。两阶段分别检查 6 和 10 个有墨迹的控件。 |
| 保留原件与打印 | 校验每份可编辑 PDF 的原始字段 `/V`、控件 `/AS`、`/AP` 引用与外观流字节。Verified 保持勾选，Contact 保持 Phone，Clinic 保持 North clinic，Sentinel 保持 `KEEP 00109`。两处映射复选框复用原有外观。每份合并文件均移除表单，所有打印页和对应的可编辑页在 4 倍渲染中逐像素相同。 |
| Excel 源警告 | 同一公式 `1=1` 在 C2 有缓存 `1`、在 C3 无缓存。界面分别显示准确坐标、不同的警告及原始可编辑值 `1` 与空字符串。输出复选框分别为 Yes 与 Off。未计算缺失的缓存。 |
| 字体失败与恢复 | 上传 Noto Sans 时，两行阿语姓名均标记 `Name / missing-glyphs`，ZIP 和合并按钮禁用，审计 JSON 只记录失败。改用上传的 Noto Naskh Arabic 后两行恢复，单页内姓名和编号各自只引用一个已嵌入的 `ArabiFormCustom` TrueType 字体。两张下载页均与合并页逐像素一致。换成损坏的 TTF 后，旧下载及审计全部禁用，预览退回原模板；清除后恢复默认字体并可导出。 |
| 本地预设 | 两种视口下载的 v1 JSON 都是 221 字节。逐项核对版本、含 Consent 的字段映射、命名模式、最小字号和内置字体设置。手动解除 Consent 映射后重新导入文件，映射恢复。预设不含字体字节。 |

字体正例用诊所名单中的前两行，编号 `00001`、`00002` 和两个姓名均在所选字体的覆盖范围内。PDF.js 生成的自定义字体预览在桌面有 2,060 个深色像素，在移动视口有 796 个。实际下载的嵌入字体、渲染器警告和像素检查提供独立验证。原始三行含 `AR-00042` 的名单用于混合控件验收。

## 文件名、浏览器与静态站点

测量的逻辑文件名为 `00001-ليلى حسن.pdf` 和 `AR-00042-ق-سَلْمَى بِنْت يَاسِين.pdf`。在 `/`、`/ar/pdf-mail-merge` 的两种视口上分别选择两行。原始逻辑字符串和 `dir="ltr"` 全部一致。对队列与摘要逐一用 DOM Range 测量，后缀右缘与容器右缘偏差最大 **0 CSS px**，词干侵入后缀最大 **0 px**，数字或拉丁前缀与首行文字左缘偏差最大 **0 px**。手机发生折行的部分按前缀所在行比较。[英页截图](screenshots/m3/desktop-m3-ltr-filenames.png) · [阿语页截图](screenshots/m3/desktop-m3-ar-rtl-filenames.png)

32 个浏览器上下文回执共记录 494 个本地 HTTP 请求、166 次 Worker 创建，两种视口各有 247 个请求和 83 次 Worker 创建。外发 HTTP/S、WebSocket、浏览器脚本或控制台错误、HTTP 错误均为 0。生产构建加载了实际的批处理 Worker 和 PDF.js Worker。桌面与触屏视口的页面宽度、根元素和 body 的滚动宽度一致。200 行回归分别在 29.088 秒与 28.471 秒内完成预检，两个 ZIP 的 200 份文件均逐份读回。这些时长是本机单次观测值。[网络观测与宽度断言](../../tests/e2e/browser.ts)

五个直接访问的静态路径是 `/`、`/arabic-pdf-form-filler`、`/ar/pdf-mail-merge`、`/preserve-leading-zeros-pdf` 和 `/privacy-and-proof`。两种视口均验证原始响应的标题、描述、canonical、语种、方向、JSON-LD、sitemap 和 robots。静态 HTML 和运行 DOM 的具名表单数均为 0。响应头含 `connect-src 'none'`、`worker-src 'self'` 和 `form-action 'none'`。独立的测试上下文尝试同源 fetch，Edge 实际阻止并触发 `connect-src enforce`。[静态产物与 CSP 浏览器测试](../../tests/e2e/seo.spec.ts)

## 截图与回放

五张截图均已打开目检。桌面混合表单图包含源文件、映射及完整生成页，移动图包含生成页和修复后 3 行 Ready 的队列。自定义字体图可见字体家族、仅在本地标签页使用的说明及覆盖检查。两张文件名图均可对照队列和所选行。[桌面混合表单](screenshots/m3/desktop-m3-mixed-widgets.png) · [移动混合表单](screenshots/m3/mobile-m3-mixed.png) · [本地自定义字体](screenshots/m3/desktop-m3-custom-font.png) · [英文文件名](screenshots/m3/desktop-m3-ltr-filenames.png) · [阿语文件名](screenshots/m3/desktop-m3-ar-rtl-filenames.png)

项目主目录的 `test-results/m3-evidence/` 由主执行端保留本次本机证据。`qa-core-pixels.json` 是 QA 完整像素报告 `test-results/pdf-pixels/manifest-verification.json` 的副本。`qa-edge/` 包含 32 个运行回执、4 份文件名坐标记录、16 份像素校验清单与浏览器实测值，`qa-edge-summary.json` 为汇总。主执行端另保留修复前后文件名记录及两种视口的实际 Adobe OTF 上传记录 `lead-otf-edge.json`。这些回执及 `inputs/` 内的官方文件不随 Git 分发；已提交的测试、合成样本和截图可用于独立复跑。

在 D 盘主仓库已有依赖、系统 Edge 以及 PyMuPDF 1.26.7 的环境执行以下 PowerShell。前四个环境变量将测试临时文件和 npm 缓存放在 D 盘。默认像素命令完成后，再提供本机保留的五份输入复跑完整配置。

```powershell
$qaScratch = Join-Path (Get-Location) 'test-results\m3-replay'
$qaInputs = Join-Path (Get-Location) 'test-results\m3-evidence\inputs'
$env:TEMP = Join-Path $qaScratch 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $qaScratch 'npm-cache'
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:npm_config_cache | Out-Null
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:ARABIFORM_E2E_PORT = '4187'
$env:ARABIFORM_PUBLIC_TEMPLATES = $null
$env:ARABIFORM_CUSTOM_CFF_FONT = $null
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:fuzz
npm.cmd run generate:fixtures -- --check
npm.cmd run verify:pixels
$env:ARABIFORM_PUBLIC_TEMPLATES = $qaInputs
$env:ARABIFORM_CUSTOM_CFF_FONT = Join-Path $qaInputs 'SourceSerif4-Regular.otf'
node scripts/verify-public-templates.mjs $qaInputs
npm.cmd run verify:pixels
npm.cmd run build
npm.cmd run test:e2e
```

只有重拍截图时需要设置 `ARABIFORM_CAPTURE_M3_SCREENSHOTS=1`。本地运行未使用线上 Cloudflare、远端 CI 或真实移动设备。正式站点域名、部署后响应头及七天验证归上线阶段。[上线检查](../launch/cloudflare-and-7day-plan.md)
