# ArabiForm v1.1.0 独立验收

**M11 通过本机验收。** 桌面和手机都能从 PDF 控件定位到正确的映射行，也能从映射行跳回另一页。真实下载保留了 `0001`、`0002`、带前缀的证书编号和阿拉伯数字日期。两个视口的实际下载均通过 4 倍渲染，控件边缘裁切和控件外像素变化均为 0。最终 Edge 套件通过 96/96 项，保留 M1–M10 全部 90 个既有场景。本次交付为本机验收版本。

## 版本与范围

独立 QA 于 2026-11-27 在干净 `main` 的 `886aa6d782f3a3cd311cef635f21a70e2c125ff8` 运行完整验收。该提交只增加 Edge 用例、像素比较和三张截图，产品修复位于 `20c5a6b`。Node 24.22.1、Microsoft Edge 124.0.2478.80、PyMuPDF 1.26.7。真实桌面视口 1440 × 900，手机为同一 Edge 引擎的 390 × 844 触屏模拟。QA 工作树端口 4192 先通过 6 个新增用例，主干端口 4187 使用单执行者、零重试。依赖、临时文件、浏览器测试配置文件和收据使用 D 盘。[任务合同](../tasks/M11-canvas-click-map-virtual-columns.md)

| 主干命令 | 实测结果 |
|---|---|
| `npm run typecheck` | 通过。 |
| `npm test` | 18 个文件，100/100 项通过。 |
| `npm run test:fuzz` | 30/30 组通过。同一主干、种子 1243704626 的详细重放记录 12,050 例实际接受、0 例丢弃、0 个失败属性。800 组原始输入和字节子视图的 SHA-256 用例有独立的 15,000 ms 超时。 |
| `npm run generate:fixtures -- --check` | 23 个合成夹具匹配。另对本机缓存的 4 个官方空白模板复验 SHA-256、页数及字段，4/4 通过。 |
| `npm run verify:pixels` | pdf-lib 读回 36 次填充，4 个受保护输入按约定拒绝。PyMuPDF 4× 验证 120 个有墨迹的控件，0 个裁切像素、0 个控件外变化，全部案例最小墨迹内距为 6 个渲染像素。 |
| `npm run build`、`npm run verify:release` | 5 条静态路由。最大入口 282,637 字节 / gzip 88,944 字节，分别距严格上限 2,363 / 56 字节。站点地图、响应头、许可与 CI 校验通过。 |
| `npm run test:e2e` | 96/96 项，桌面、手机各 48 项，7.5 分钟。按文件、测试 ID、标题、视口逐一比对，旧 90 项均保留，M11 增加 6 项。 |

8 个正式入口的最终原生退出码均为 0。Windows 沙箱首次启动像素命令时，tsx 在读取当前账户信息时返回 `uv_os_get_passwd ENOMEM`，原生退出码为 1。在相同提交和 D 盘夹具上执行同一条本机命令后退出 0。两份日志均保留。公开模板、CFF 字体都取自既有本机缓存。此前的像素用例也通过，包括 17 张合并页、8 张压平 ZIP 页、7 张封面、54 条索引、82 张封面前后正文、4 个来源指纹页脚及 4 张盖章页。[像素验证器](../../scripts/verify-pdf-pixels.py)

## 控件位置、键盘与可见墨迹

在 Workshop 合成工作表上，鼠标点击 `ID` 控件后，对应下拉框取得焦点，行和控件同时高亮。按 Enter 激活 `Title` 后焦点进入该字段。阿语 RTL 测试使用含非零 CropBox 的四页 PDF，为同一字段的四个控件画上洋红色定位边。按适应宽度和 125% 两档缩放，直接从 PDF.js 画布读取定位边的实际像素，逐边对照 DOM 控件的位置。两种视口共检验 16 个组合，覆盖 0°、90°、180°、270°。焦点从第四页移到仅在第二页出现的 Multiline 映射行时，预览自动跳到第二页。按空格激活该页的重复控件，映射选择器取得焦点，页码保持在 2。另用 PDF.js 视口变换对照 12 个控件，包含被页边裁切的控件，归一化坐标的最大绝对误差为 2.22 × 10⁻¹⁶。[浏览器完整用例](../../tests/e2e/m11-canvas-virtual.spec.ts) · [几何单测](../../tests/core/m11-widget-overlays.test.ts)

初版选中态的白色内边遮住 `CERT-0001` 首字母。独立实绘比较在桌面检出 7 个消失的笔画像素，在手机检出 4 个。描边移到边框外侧后，分别对照 86、43 个墨迹采样点，遮挡都降为 0。截图取自浏览器完成当行 PDF 渲染后的实际状态。[选中态像素比较](../../tests/e2e/m11-overlay-ink.py) · [经验记录](../../LESSONS.md)

## 两项实际下载与预设

名单带有真实文本列 `ROW_INDEX` 和 `@PADDED_ROW_001`。前者与计算列同名，后者与下拉框的首选编码冲突。组合模式 `take-{{ROW_INDEX}}-{{@PADDED_ROW_001}}-[[@PADDED_ROW_001]].pdf` 在两个视口均生成以下独立成员。

| ZIP 成员 | ID 的 `/V` | Title 的 `/V` | Notes 的 `/V` |
|---|---|---|---|
| `take-00701-00901-0001.pdf` | `0001` | `CERT-0001` | `٢٠٢٦-١١-٢٧` |
| `take-00702-00902-0002.pdf` | `0002` | `CERT-0002` | `٢٠٢٦-١١-٢٧` |

主执行端另用 PyMuPDF 读回双视口的四份实际 ZIP 成员，逐份核对文件名、字段值和 SHA-256。两份成员的未映射 `Sentinel` 均保留 `KEEP 00109`。CSV 和 JSON 都保留原有五个字段，并逐项核对行号、文件名、就绪状态、诊断及实际字号。单页预览从第 1 行切至第 2 行，再返回，ID 框内墨迹指纹随末位数字变化并恢复。PyMuPDF 从实际下载字节得到两份序号的 1,518 / 1,611 个墨迹像素，两个前缀值为 3,041 / 3,134 个，阿语日期各为 1,337 个。此批次所有写入字段内距至少 12 个四倍渲染像素，范围外变化为 0。[导出与读回](../../tests/e2e/m11-canvas-virtual.spec.ts) · [虚拟列约定](../subsystems/roster-mapper.md)

工作台实际导出并重新导入 v6，恢复序号、日期和前缀。另逐个通过文件选择器导入 v1、v2、v3、v4、v5。仅文件名使用虚拟值时再次导出 v6，刷新并导入后，真实列仍分别填出 `00701/00702` 和 `00901/00902`。带前缀的值也经过 `/MaxLen` 和墨迹预检。[预设与长度回归](../../tests/core/m11-virtual-columns.test.ts)

## 浏览器收据与截图

96 份运行收据共记录 3,092 个本地 HTTP 请求。外部请求、WebSocket、HTTP 错误、控制台错误、运行时错误及 PDF.js 假工作线程均为 0。英文与阿语冷启动均未加载 PDF 引擎或嵌入字体 JS，阿语界面使用本机 CSS 字体。两种视口的页面横向溢出断言均通过。套件退出后，4187 和 4192 均拒绝新连接。

- [桌面点选 ID](screenshots/m11/desktop-m11-canvas-click-map.png) 同时显示高亮的 PDF 控件、映射行和拥有焦点的下拉框。
- [桌面编号](screenshots/m11/desktop-m11-virtual-serial.png) 显示 `0001`、`CERT-0001` 和描边外置后的选中控件。
- [手机画布](screenshots/m11/mobile-m11-canvas-map.png) 在 390 px 宽度显示完整工作表及选中的 ID 控件。

主工作区本机目录 `test-results/m11-evidence/` 保留原生命令日志、精确提交、场景清单、四旋转独立对照、选中态红绿图、真实 ZIP / PDF、审计及 PyMuPDF 输出。该目录由 Git 忽略，三张截图和复跑用例随仓库提交。

## 主线交付

四个 D 盘临时工作树、对应分支及工作树目录均已移除，Git 只登记主工作区。早期冒烟测试的一条日志仍由孤立的无头 Edge 渲染进程占用，按文件锁确认进程和启动时刻后结束了该测试进程。4187、4191、4192 均已关闭。正式验收提交后的变更限于本报告和经验记录。[工作树清理](../../test-results/m11-evidence/lead-worktree-cleanup.json) · [临时日志锁释放](../../test-results/m11-evidence/lead-web-cleanup-lock-released.json) · [预览端口](../../test-results/m11-evidence/lead-preview-shutdown.json)

本轮新增的画布遮墨经验计一次。Windows 像素校验启动问题累计六个周期，继续沿用已纳入代码标准的同版本复跑办法。[经验记录](../../LESSONS.md) · [代码标准](../code-standards.md)

[96 项场景汇总](../../test-results/m11-evidence/qa-formal-summary.json) · [Fuzz 实际计数](../../test-results/m11-evidence/qa-main-fuzz-observed.log) · [下载成员独立复算](../../test-results/m11-evidence/lead-final-zip-readback.json) · [四方向坐标对照](../../test-results/m11-evidence/lead-widget-geometry-integrated.json) · [截图尺寸与哈希](../../test-results/m11-evidence/lead-screenshots.json)
