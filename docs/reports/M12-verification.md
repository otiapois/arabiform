# ArabiForm v1.2.0 独立验收

**M12 通过本机验收。** 两个不同编号在 Edge 预览、合并 PDF 和压平 ZIP 中逐行一致。可编辑 ZIP 保留原字段、外观及页面像素。双语封面可读，页码索引准确。Edge 全套通过 102/102 项，保留 M1–M11 的全部 96 项。固定种子实跑 15,000 例，丢弃和失败均为 0。本次范围为本地构建与下载文件。

## 版本与运行环境

2026-11-27，独立 QA 使用与干净主线相同的 `da1422e1dfa6ba697095bf7a69eacad0cfa02f60`。产品修订到 `ddf41f2`，之后的测试提交只增加真实 Edge 用例、4 倍像素检查器和三张截图。环境为 Node 24.22.1、Microsoft Edge 124.0.2478.80 和 PyMuPDF 1.26.7。桌面视口为 1440 × 900，手机使用同一浏览器的 390 × 844 触屏模拟。运行器使用 4192 私有端口、单执行者、零重试，临时目录、缓存、夹具和收据均位于 D 盘。[任务合同](../tasks/M12-local-vector-qr-stamp-dual-cover.md) · [正式验收摘要](../../test-results/m12-evidence/qa-formal-summary.json)

| 验收入口 | 实测结果 |
|---|---|
| `npm run typecheck`、`npm test` | 类型检查通过，20 个文件中 119/119 项通过。 |
| `npm run test:fuzz` | 33/33 组通过。详细重放使用种子 1243704626，实际接受 15,000 例、丢弃 0 例、失败属性 0 个。新增 1,200 例编码和输入边界、950 例角点变换、800 例双语封面与分页。[计数原文](../../test-results/m12-evidence/qa-fuzz-observed.log) |
| `npm run generate:fixtures -- --check` | 23 个合成夹具匹配。另核对 4 个本机缓存的官方模板，4/4 通过 SHA-256、页数与表单结构检查。[官方模板收据](../../test-results/m12-evidence/qa-public-templates.log) |
| `npm run verify:pixels` | 38 次填充、128 个有墨迹的控件、4 个受保护输入拒绝。4 倍渲染下，控件边缘裁切与控件外变化均为 0，最小墨迹内距为 6 像素。[像素报告](../../test-results/m12-evidence/qa-pixels-manifest-verification.json) |
| `npm run build`、`npm run verify:release` | 默认域名和本地测试域 `https://release.arabiform.test` 均通过。测试域同时通过 `--strict-origin`。五条路由共用入口 `index-BTsDPsJ0.js`，274,835 B 原始大小、86,727 B gzip，分别距严格上限 5,165 B、773 B。[常规校验](../../test-results/m12-evidence/qa-release.log) · [严格域名校验](../../test-results/m12-evidence/qa-strict-release.log) |
| `npm run test:e2e` | 102/102 项通过，桌面和手机各 51 项，共 7.2 分钟。按原文件、测试 ID、标题和浏览器项目比对，96 个既有场景全部保留，新增 6 项。[Edge 运行日志](../../test-results/m12-evidence/qa-edge.log) |

像素命令首次在 tsx 初始化时返回 `uv_os_get_passwd ENOMEM`。获准在本机以相同 SHA、输入、D 盘临时目录重跑原命令后，pdf-lib 与 PyMuPDF 全程退出 0。以这次重新生成的报告作为像素结论。[启动错误](../../test-results/m12-evidence/qa-pixels-sandbox.log) · [本机复跑](../../test-results/m12-evidence/qa-pixels-native.log)

## 二维码在实际 PDF 中的内容

两个视口均上传同一张两页合成 AcroForm 和两行 CSV。第一页直立，第二页旋转 90°，两页均有偏移 CropBox。设置右下角、48 pt、`CERT-{{ID}}` 后，用浏览器 SVG 几何逐格采样。两行的实际矩阵不同，分别解出下列 UTF-8 字节。PDF 页与压平 ZIP 对应页的完整 4 倍图像一致。[浏览器用例](../../tests/e2e/m12-qr-print.spec.ts) · [实际下载像素对照](../../tests/e2e/m12-qr-proof.py)

| 名单 ID | 二维码内容 | 符号与掩码 | 双语封面索引 |
|---|---|---|---|
| `00123` | `CERT-00123` | 版本 1，M 级，掩码 1 | `00123.pdf`，第 2–3 页 |
| `00007` | `CERT-00007` | 版本 1，M 级，掩码 0 | `00007.pdf`，第 4–5 页 |

每张正文检验 21 × 21 个编码模块、三个 7 × 7 定位图案以及连续四模块白色静区。每张图有 21,904 个模块内部取样像素。盖章方框至下边和右边均为 9 pt，区域外像素变化与页边裁切均为 0。独立读取器对两个视口的 8 对合并页与 ZIP 成员页进行了 16 次 4 倍解码。它从真实 PDF 栅格还原字节，并校验两份格式信息、Reed–Solomon 校验字与全部八种掩码的得分。[桌面像素收据](../../test-results/m12-evidence/qa-browser/desktop/qr-downloads/physical-proof.json) · [手机像素收据](../../test-results/m12-evidence/qa-browser/mobile/qr-downloads/physical-proof.json) · [独立解码收据](../../test-results/m12-evidence/lead-qr-edge-readback-final.json)

可编辑 ZIP 在二维码开启前后分别下载，两份成员仍可编辑，ID 保留前导零，未映射字段保留 `KEEP 00109`。原始 `/V` 表示、`/AP` 字典与正常外观流字节相同，四张可编辑页的 4 倍渲染也相同。核心像素套件还覆盖左上角 36 pt 与右下角 72 pt、0°／90°／180°／270° 的八张印刷页，逐一核对 8,488 个模块。模板碰撞、未知标记、ASCII 超出 106 字节、带 UTF-8 ECI 的内容超出 105 字节均有回归断言。[核心回归](../../tests/core/qr-stamp.test.ts) · [编码读回](../../tests/core/qr-proof.ts)

## 双语封面、预设与拒绝导出

第一页左栏为英文，右栏为阿语，两边都显示 2 份就绪、0 份待查、0 份跳过。逐项核对两语种的标题、标签、绘字位置、非空墨迹和表中两个实际页段。开启二维码前后，封面同位置的全部像素一致。另测 30 条记录的双语清单，实际使用 3 张封面，31 张正文逐页一致。连同既有套件共验 10 张封面、84 条索引、113 张正文、4 个来源指纹页脚及 4 张水印页。[实际打印封面](../../test-results/m12-evidence/qa-browser/desktop/qr-downloads/printed-cover.png) · [可打印 PDF](../../test-results/m12-evidence/qa-browser/desktop/qr-downloads/stamped/arabiform-merged.pdf)

从界面实际导出 v7 后，依次导入 v1 至 v6，再分别恢复 v7。六个旧版本均恢复默认二维码关闭和封面语言自动匹配。重新载入 v7 会展开二维码设置并恢复右下角、48 pt、原模式及双语。另设首行有效、次行为空或含 106 个 UTF-8 字节的阿文，合并和压平 ZIP 都指明第 2 行错误，下载事件为 0。保持同一无效行导出可编辑 ZIP，两份成员均成功并保留原字段。[预设与拒绝导出用例](../../tests/e2e/m12-qr-print.spec.ts)

## 空载请求、截图与发布边界

102 份运行收据记录 3,421 个同源 HTTP 请求，外部请求、WebSocket、HTTP 错误、控制台与运行时错误、PDF.js 假工作线程均为 0。英阿入口在两个视口启动时均只请求入口 JS，PDF 引擎、二维码和嵌字字体 JS 均按需加载。390 px 双语页面无横向溢出。套件退出后 4192 端口拒绝连接。静态构建保留五条路由、站点地图、robots、许可清单和 CI。实际响应头包含 `connect-src 'none'`、`worker-src 'self'`、`form-action 'none'`。本轮无部署。主工作区的 `test-results/m12-evidence/` 保留实际 PDF、ZIP、日志与运行收据，三张截图和复跑用例随 Git 提交。[静态发布收据](../../test-results/m12-evidence/qa-default-release.json) · [网络与视口收据](../../test-results/m12-evidence/qa-formal-summary.json)

- [桌面英文](screenshots/m12/desktop-m12-qr-stamp-preview.png) 同屏显示双语封面、二维码位置、模式、大小以及第 1 行预览。
- [桌面阿语](screenshots/m12/desktop-m12-ar-rtl-qr.png) 显示 RTL 输出设置及第 2 行的不同二维码。
- [手机](screenshots/m12/mobile-m12-qr.png) 显示 390 px 视口完整的二维码预览和封面语言。

开发时图库加载器的分包名占用了样本数据的 `sample-` 前缀，旧图库测试在一次选择后计到两个包。提交 `ddf41f2` 明确了加载器名称，原测试在两个视口均通过。该问题按 M12 记一次。Windows 像素命令启动问题累计七个周期，适用做法已纳入代码标准。[经验记录](../../LESSONS.md) · [代码标准](../code-standards.md)

## 主线收口

验收结果和经验记录已快进至 `main`。清理前 4187、4191、4192 均拒绝连接。四个 M12 工作树、D 盘团队临时目录和对应临时分支已删除，只保留 ArabiForm 主工作树。主工作树的 TypeScript 依赖仍可读，本机验收原始收据保存在 `test-results/m12-evidence/`。[清理收据](../../test-results/m12-evidence/lead-worktree-cleanup.json)
