# ArabiForm M1 独立验收

2026-11-26，Worker E 在 A–D 合并后的代码上完成本地验收。两种视口各跑 6 项，系统 Edge **12/12 通过**。CSV 和 Excel 均能从文件选择器走到实际下载。四次流程共验证 36 份单页 PDF、144 个已填字段和 36 张合并页，4 倍渲染结果中裁切与字段外像素变化均为 0。覆盖范围内未发现待修 P0/P1，正式发布与产品最终验收由项目负责人决定。

## 运行环境与范围

| 项目 | 实测版本或条件 |
|---|---|
| A–D 集成基线 | `10fdb8808baa2e69593bfc5d53193ecd4892156d` |
| QA 用例与截图提交 | `cb8c26eebdf17d93e00038167ff168c6aa0987df`，无业务代码变更 |
| 浏览器 | Windows 上已安装的 Microsoft Edge `124.0.2478.80`，Playwright `1.65.1` 使用 `channel: 'msedge'` |
| 桌面与移动 | 1440 × 900 桌面视口，390 × 844 触控移动视口模拟，DPR 均为 1 |
| 校验工具 | Node.js 24.22.1、npm 11.11.0、Python 3.13.11、PyMuPDF 1.26.7、PDF-lib 1.17.1 |
| 站点入口 | `npm run build` 产出五个静态 HTML。`node scripts/serve-dist.mjs` 在回环地址提供原始产物，并将 `dist/_headers` 作为 HTTP 响应头返回 |

## 浏览器里的完整操作

桌面和移动各自上传真实的合成 `template.pdf`，分别配对 `roster.csv` 和 `roster.xlsx`。解析器和 PDF 渲染器使用正式构建。两种名册都保留了原有多行备注、阿拉伯附标及文本编号。Excel 的 `Numeric IDs` 工作表显示 3 行来源警告，含普通数字编号、带科学计数格式的数字和科学计数字符串。切回 `Roster` 后恢复 5 行、0 条来源警告。[工作台用例](../../tests/e2e/workbench.spec.ts)

| 实际下载阶段 | 界面状态 | 每轮下载校验 |
|---|---|---|
| 第 5 行姓名过长 | 4 行可导出，1 行待改。选中第 5 行后，2 px 红框与原 PDF 的 Name 部件位置和尺寸吻合。 | ZIP 包含前 4 份，合并 PDF 共 4 页。CSV、JSON 审核报告各含 5 行，第 5 行记录 `Name / too-narrow`。 |
| 将姓名改为 `ليلى حسن` | 无须重新上传，立即变成 5 行可导出、0 行待改。红框消失，预览重新绘制。 | ZIP 包含 5 份，合并 PDF 共 5 页。两种审核报告的行号、文件名、状态、诊断与字号一致。 |

用 PDF-lib 逐字段比对 ZIP 里的实际字节，`00123`、`00007` 等编号与源名册完全一致。`KEEP 00109` 的原始值、外观字典及正常外观流字节均保留。PyMuPDF 逐页比较合并页和对应的单页文件，验证了不同编号的内容及顺序。渲染放大 4 倍时，所测浏览器下载样本中文字距部件边缘最少 10 个像素。36 份输出包含两种视口、两种输入格式及修正前后的重复验算，使用的是同一组 5 条合成记录。[下载与精确回读](../../tests/e2e/downloads.ts) · [像素比较](../../scripts/verify-pdf-pixels.py)

浏览器启动了本站正式构建的 PDF.js Worker。桌面 CSV 首条记录的画布实测 471 × 609，其中 2,829 个深色像素、221,763 个近白纸面像素。移动端画布为 332 × 430。更换为 XFA、无字段、加密或带签名字段的模板后，页面给出相应解释，清除旧预览并禁用两种 PDF 导出。[浏览器观测方法](../../tests/e2e/browser.ts)

## 模板与公开页面

- **核心与像素**。严格类型检查通过，Vitest 两个文件共 11 项通过。重新生成对照时，8 个合成样本与跟踪字节一致。独立运行核心像素套件，共 10 次填充、36 个有墨迹的部件、5 张合并页逐像素相同。裁切和字段外变化均为 0，最小实测边距为 4 倍渲染下的 6 个像素。与浏览器下载统计分开计数。[核心用例](../../tests/core) · [像素套件入口](../../scripts/verify-pdf-pixels.ts)
- **真实空白表**。重新核对本地四份官方空白模板的 SHA-256 与字段结构。USPTO SB/01、美国法院 AO 440、USCIS I-9 上所选字段完成填充。AO 440 的 Defendant2 在 8 pt 下报警，允许下限 6 pt 后以 7.48 pt 填入。IRS W-9 含 XFA，按预期拒绝。完整运行的有墨迹部件包括合成模板和上述三份 AcroForm 的选定字段。[空白表版本与来源](../../scripts/verify-public-templates.mjs)
- **静态路由与 CSP**。五个直达路径分别返回 HTTP 200。原始 HTML 各有独立标题、描述和 canonical，FAQPage 与 SoftwareApplication 均可解析。网站地图含相同五页，robots 指向同一站点地图；原始 HTML 与挂载后的 DOM 中均未发现具名提交表单。阿语页面带 `lang="ar" dir="rtl"`。直接检查 `connect-src 'none'`、`worker-src 'self'`、`form-action 'none'`、nosniff 及 no-referrer。隔离标签页对同源 robots 发起无数据请求，Edge 以 TypeError 拒绝，并派发 `connect-src enforce` 事件。[路由与策略用例](../../tests/e2e/seo.spec.ts)
- **网络与版面**。12 个正常用例的页面上下文共记录 156 次站内 HTTP 请求、32 次 Worker 创建。外部请求、WebSocket、HTTP 错误、控制台错误及未捕获错误均为 0。故意触发 CSP 拒绝的独立上下文单独验算。390 px 下五个路由、英阿示例载入前后、行编辑及拒绝后均检查文档宽度，横向溢出为 0。样本明确标为合成，仅使用固定虚构名册。已逐张打开下列六张原始截图核对。

| 桌面 1440 × 900 | 移动 390 × 844 |
|---|---|
| [英文首页](screenshots/desktop-home.png) · [第 5 行红框](screenshots/desktop-preview-flagged.png) | [英文首页](screenshots/mobile-home.png) |
| [五行可导出](screenshots/desktop-fixed-ready.png) · [阿语 RTL 已载入示例](screenshots/desktop-ar-rtl.png) | [已填 PDF 及预检队列](screenshots/mobile-preview.png) |

## 对照八条代码标准

| 审查项 | 此次依据 |
|---|---|
| 先检查模板保护 | 从加密 trailer、原始 AcroForm 和签名树到 `getForm()` 的调用顺序已复核，四类拒绝均通过真实浏览器输入。 |
| 真实字形边界 | 检查 fontkit 的 glyph bbox、advance、offset 和基线计算，另用 PyMuPDF 实测附标、下伸笔画与字段边缘。 |
| 跨页部件原子性 | 四个旋转页上的重复字段进入逐部件排版。窄部件异常时全行无可导出的 PDF，核心用例覆盖旋转部件及长度和高度限制。 |
| 文本编号与前导零 | 同一组 CSV 与 Excel 独立走完上传及导出，来源数字警告可见，每个编号与预期逐字符一致。 |
| 保留未映射字段 | 原始模板与输出的 `/V`、`/AP` 及正常外观流字节已比较。 |
| 本地资源 | 本地两款字体及两份 OFL 的 SHA-256 与通知文件相符。实际页面使用本地 Worker 与打包资源。 |
| 同类路径一并复核 | CSV/XLSX、ZIP/合并 PDF、审核 CSV/JSON、英阿页面均覆盖；数字实体换行用例与真实下载的多行内容相互校验。 |
| 真环境修复回归 | 字体显示、加密分类、Excel 换行及并行模板重建引起的假差异均有记录。此次独立运行验证当前修复态；历史红色结果来自对应开发记录。 |

[代码标准](../code-standards.md) · [有来源的缺陷与修正](../../LESSONS.md) · [依赖与字体许可](../../THIRD_PARTY_NOTICES.md)

## 复跑及适用边界

从仓库根目录运行以下命令。可选环境变量 `ARABIFORM_PUBLIC_TEMPLATES` 指向已有的四个空白表；省略时仍可复跑跟踪的合成套件。Windows 上本次将 `TEMP`、`TMP` 与 npm 缓存放在 D 盘；浏览器使用已安装的系统 Edge。设置 `ARABIFORM_CAPTURE_SCREENSHOTS=1` 可重新采集六张截图，默认复跑仅更新忽略目录中的测试产物。

```sh
npm run typecheck
npm test
npm run verify:pixels
npm run build
npm run test:e2e
```

每个浏览器用例的请求与异常记录在 `test-results/e2e/<用例>/runtime.json`。上传用例的 `flagged/`、`fixed/` 分别保留浏览器下载、解包单页、像素清单及逐部件报告。核心像素数据可以在 `test-results/pdf-pixels/manifest-verification.json` 复查。

本机 Windows 沙箱曾使 tsx 读取用户信息返回 `uv_os_get_passwd ENOMEM`。按同一范围运行的本地像素命令通过。另一次沙箱内 E2E 跑完 12 项后，Playwright 等待预览子进程退出，定向回收该进程后退出码为 0。以批准的本地运行权限重复常规 E2E，**12/12，49.7 秒，退出码 0**。复核原预览 PID 已退出，4187 端口拒绝连接。

结果适用于上述 Edge 版本、视口、模板版本和字段。移动端使用视口模拟，阿语母语审校、真机浏览器、物理打印、真实域名的 Cloudflare 响应及搜索收录尚未验收。当前构建使用 `https://arabiform.example` 占位来源。Vite 构建成功，同时提示 PDF、预览及字体相关延迟加载资源超过 500 kB。

## 主线复跑与交付

在 `main` 的 `78b2e3cfcd3c33c23dbf5bfb9920f962017e43ee` 复跑 typecheck、Vitest、4× 像素核验、五路由构建和 Edge E2E，全部退出码为 0。Edge 12 项用时 48.5 秒。主线 JSON 回读确认 156 次同源 HTTP 请求和 32 个本地 Worker，外部请求、WebSocket 与浏览器错误均为 0。六张原始截图的像素尺寸与两种测试视口一致。验收后的改动限于报告与实际教训。

五个临时工作树、已合并的临时分支及 `.arabiform-wt` 已清理，主目录的 D 盘依赖及 `dist/` 保留。GitHub Actions 的四项检查已在本机执行，远端工作流尚无运行记录。两款字体附有原始 OFL，`@pdf-lib/fontkit` 1.1.1 的上游包未附独立版权通知，现有声明及可核许可材料已落盘。 [第三方许可](../../THIRD_PARTY_NOTICES.md)
