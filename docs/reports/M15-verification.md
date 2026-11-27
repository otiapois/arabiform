# ArabiForm v1.5.0 独立验收

M15 通过本机发布验收。平面 PDF 能在浏览器中添加字段、下载为标准 AcroForm 模板，再直接批量填写。桌面与移动 Edge 共 122/122 项通过，包含原有全部 116 项。真实 ZIP 内的姓名、阿文附标及复选状态均能从 PDF 与 M14 提取结果准确读回。4 倍渲染未发现裁切或框外变化。[冻结主线命令及退出码](../../test-results/m15-evidence/qa-formal.json) · [正式 Edge 收据](../../test-results/m15-evidence/qa-edge-summary.json)

## 验收环境

2026-11-27，独立 QA 在本机主目录的干净 `main` 上运行发布检查。冻结提交为 `79d2494ba822a504eff2372d9f89f5c292c0df96`。使用 Node 24.22.1、npm 11.11.0、Python 3.13.11 和 PyMuPDF 1.26.7。两种视口共用 Microsoft Edge 124.0.2478.80，桌面为 1440 × 900，移动为 390 × 844 触屏模拟。浏览器使用本地产物、依赖、字体及 D 盘临时目录。验收范围为本机生产构建。[任务书](../tasks/M15-flat-pdf-visual-field-designer.md)

## 从平面 PDF 到可编辑填表结果

将 `fixtures/golden/flat.pdf` 拖入默认的 Fill 页面，界面提示找不到可填写字段。点击警告中的 **Open in Visual Field Designer** 后，同一份 PDF 成为设计底图。桌面鼠标和手机触控分别画出 `Name` 与 `Verified`。用原页 612 × 792 pt 独立换算拖动坐标，随后在属性面板设置精确位置，核对 1 pt、5 pt 按键位移、Undo 及删除后撤销。下载的 PDF 原生控件读回如下。[浏览器用例](../../tests/e2e/m15-designer.spec.ts)

| 字段 | PDF 原始坐标 [X, Y, W, H] | 从下载文件读取 |
|---|---|---|
| Name | [74.5, 526.25, 265.75, 43.5] | 文本、右对齐、多行、最长 64、默认 15 pt |
| Verified | [75.25, 450.5, 22, 22] | 复选框，初始未选中 |

保存布局 JSON 后，换入另一份同名、页面外观相同的 PDF。新文件只多一条尾部注释，SHA-256 已改变，加载布局提示来源不匹配，模板导出仍禁用。重新选择原始 PDF 后，两个字段的位置与属性全部恢复。英文和阿语合成证书分别用本地示例画出两种控件，下载的模板能按显示的字段名和对齐方式读回。[英文设计器](screenshots/m15/desktop-m15-designer-en.png) · [阿语设计器](screenshots/m15/desktop-m15-designer-ar.png) · [阿语手机](screenshots/m15/mobile-m15-designer.png)

点击 **Use in Fill PDFs Now**，填表工作台接收已设计模板。载入 UTF-8 名单后，生成两条可填写记录。在真实 ZIP 的 `00123.pdf` 和 `00007.pdf` 中读回 `سَلْمَى بِنْتُ يَاسِين` 与 `مُحَمَّد سَالِم`，复选框字段 `/V` 和控件 `/AS` 分别是 `/Yes` 与 `/Off`。再把同一批 PDF 字节交给 M14 提取器，界面、下载的 CSV 和审计 JSON 均保留姓名、附标及复选状态。逐份重算 PDF 原始 SHA-256，并核对审计 JSON 记录的 CSV 文件哈希。[填表预览](screenshots/m15/desktop-m15-flat-to-fill.png)

QA 用 PyMuPDF 4× 比较两个视口实际下载的 4 份填表文件，6 个有墨迹控件均无裁切，框外像素变化为 0。主执行端另从同次浏览器 ZIP 独立解包，复核底图、原生控件、CSV 哈希与附标。[QA 下载像素结果](../../test-results/m15-evidence/qa-edge-download-pixels-verification.json) · [独立解包与读回](../../test-results/m15-evidence/lead-edge-downloads.json)

## 真实 Edge、空载与多页坐标

桌面和手机各 61 项，单执行者、零重试。按测试文件、用例 ID、标题及浏览器项目逐项比对 M14 的 16 个测试文件，原 116 项全部保留。正式套件记录 5,294 次本地请求，外部网络请求、WebSocket、HTTP 错误、控制台错误与运行时错误均为 0。套件结束后，预览端口 42875 拒绝新连接。[基线清单](../../test-results/m15-evidence/e2e-baseline-list.json) · [正式运行日志](../../test-results/m15-evidence/qa-edge.log)

英阿界面冷启动均默认进入 Fill，只有一次入口 JavaScript 请求。阿语别名 `/ar/` 返回 301，目标 `/ar/pdf-mail-merge` 以 RTL 显示。设计器加载带字段的合成证书后，画布有实际墨迹，英阿手机页面实测宽度均为 390 px。四个设计器页面实测普通文字对比度最低 5.65∶1，控件提示最低 3.21∶1，键盘焦点最低 5.88∶1。[双语逐项实测](../../test-results/m15-evidence/qa-edge-summary.json)

在正式套件退出后，将同一份四页 PDF 分别在英桌面与阿语手机打开。用鼠标和触屏在第 1、2、4 页各放一个字段，第 3 页保持空白。按原文件的可见页框与 0°、90°、270° 方向，独立将实际指针起止点换算为 PDF 坐标。切页返回、重选字段以及下载文件的控件矩形均吻合，每个控件的 `/P` 和页面 `/Annots` 也指向同一页。第 4 页 `/UserUnit=1.25`，向右 1 pt 让原始 Y 减少 0.8，向下 5 pt 让原始 X 减少 4。两种视口合计 37 次本地请求，无错误或外部连接。[浏览器手势、坐标与原生页码](../../test-results/m15-evidence/qa-multipage/receipt.json)

## 核心、实绘与发布产物

| 项目 | 冻结主线实测 |
|---|---|
| 类型、单元、夹具 | 类型检查通过，22 个测试文件共 160/160 项通过，24 个合成夹具逐字节校验通过。`fixtures/.gitattributes` 仍为 Git blob `16687c743d52cd6832cb834023e0b8160b38bf1e`。[单元日志](../../test-results/m15-evidence/qa-unit.log) · [夹具日志](../../test-results/m15-evidence/qa-fixtures.log) |
| 固定种子 | 种子 1243704626，42 项测试通过。41 组属性共接受 25,160 例，丢弃与失败均为 0。原有 22,600 例保留，本次新增 2,560 例，含 700 次经过实际生成、检查、填充和提取的阿文及复选框往返。[执行日志](../../test-results/m15-evidence/qa-fuzz.log) · [前后计数](../../test-results/m15-evidence/lead-engine-invariants.json) |
| PyMuPDF 4× | 正式输入含 4 份公开样本，3 份可填，带 XFA 的 W-9 按约定拒绝。49 次填充、149 个有墨迹控件，最小边缘内距 6 px。5 份新设计模板覆盖 0°、90°、180°、270° 和自选本地阿文字体。原页图形一致，墨迹裁切和字段框外变化均为 0。另有 17 张合并页、8 张扁平 ZIP 页与参照相同，5 张 A4 拼版共含 8 条记录、64 条裁线。[完整像素收据](../../test-results/m15-evidence/qa-pixel-output/manifest-verification.json) |
| 构建与发布 | 默认域和严格域均通过，默认产物接受严格域校验时按预期拒绝占位域名，最后恢复默认构建。5 个静态 HTML 和 5 个规范 URL 使用同一 JS 入口，274,332 B 原始、86,325 B gzip。分别距发布门限 5,668 B、1,175 B，距本次额外目标 668 B、175 B。CSP 含 `connect-src 'none'`，站点地图、robots、许可和 CI 校验通过。[产物清单](../../test-results/m15-evidence/qa-static.json) · [严格域](../../test-results/m15-evidence/qa-strict-release.log) · [占位域拒绝](../../test-results/m15-evidence/qa-default-reject.log) |

在受限 Windows 环境，tsx 初始化时收到 `uv_os_get_passwd ENOMEM`。按现有代码标准在获准的本机环境重跑相同提交、相同 D 盘输入和原命令，PDF 生成及像素比较均完成。[首次日志](../../test-results/m15-evidence/qa-pixels.log) · [同提交重跑](../../test-results/m15-evidence/qa-pixels-native.log)

## 实测中修正的项目

开发期第一次在 390 px 视口加载设计器后，页面实际宽度达到 715 px。修正画布所在网格的收缩方式后，英、阿界面在两种视口均保持页面宽度。[首次溢出](../../test-results/m15-evidence/implementation-checks/mobile-overflow-before.log) · [修复后实测](../../test-results/m15-evidence/implementation-checks/web-edge-smoke.json)

首次聚焦验收有两个用例同时找到填表与设计器的已渲染画布。收窄到当前模式的具名可见画布后，实际读取该画布的像素，6/6 个新用例通过。切换同名来源时，还等待旧画布退出和新画布完成渲染，再加载布局。英阿空载检测同时涵盖 `.js` 和 `.mjs`。[首次浏览器日志](../../test-results/m15-evidence/qa-focused-a.log) · [修正后的聚焦收据](../../test-results/m15-evidence/qa-focused-c-summary.json) · [本轮经验](../../LESSONS.md)

## 主线收尾

核心层共 46 个跟踪文件，DOM 与网络 API 扫描命中为 0。依赖声明无增减。[核心扫描](../../test-results/m15-evidence/lead-full-core-scan.json) · [依赖比较](../../test-results/m15-evidence/lead-engine-invariants.json)

四个 M15 工作树和已合并的临时分支均已清理，D 盘 `.arabiform-wt` 已移除。首次注销 QA 工作树后，Windows 留下了一个空目录，核实路径和内容后已单独移除。Git 仅列出主线工作树，TypeScript 依赖可用，四个验收端口均已关闭。[清理回执](../../test-results/m15-evidence/lead-worktree-cleanup.json)
