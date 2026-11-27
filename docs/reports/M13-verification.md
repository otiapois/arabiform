# ArabiForm v1.3.0 独立验收

M13 通过本机验收。实际切换 Excel 工作表后，三行阿文姓名、前导零和草稿绑定均正确。三条记录与双语封面实际印成三页，二维码从下载文件逐枚解出。真实 Edge 通过 110/110 个场景，保留 M1–M12 的全部 102 个。固定种子实际接受 20,100 例，丢弃与失败均为 0。

## 验收版本与入口

2026-11-27，独立 QA 在干净主目录 `main` 的 `c9d00cdc141fbfbd6ae0b6ba90bcd44872910e08` 运行正式验收。环境为 Node 24.22.1、npm 11.11.0、Microsoft Edge 124.0.2478.80、Python 3.13.11 和 PyMuPDF 1.26.7。桌面为 1440 × 900，手机为同一浏览器的 390 × 844 触屏模拟。数据、依赖、运行缓存、临时目录与收据均位于 D 盘。本轮验收范围为本地构建和真实浏览器下载。[M13 任务书](../tasks/M13-xlsx-sheet-picker-2up-imposition.md) · [主线原始收据](../../test-results/m13-evidence/qa-edge-summary.json)

| 入口 | 实测结果 |
|---|---|
| 类型、单元、固定种子 | `typecheck` 通过，20 个测试文件中 130/130 项通过。fuzz 36/36 组通过，种子 1243704626。新增 1,700 例工作表选择、1,800 例拼版与封面页码、1,600 例新旧预设。[单元测试](../../test-results/m13-evidence/qa-unit.log) · [实际次数](../../test-results/m13-evidence/qa-fuzz-observed.log) |
| 夹具与公共模板 | `generate:fixtures -- --check` 校验 24 个合成夹具的字节。4/4 份本地公共模板通过哈希及结构核验，其中 IRS W-9 按预期拒绝 XFA。[夹具收据](../../test-results/m13-evidence/qa-fixtures.log) · [公共模板](../../test-results/m13-evidence/qa-public-templates.log) |
| 核心 PDF 像素 | 44 次填充、140 个有墨迹控件，4 倍渲染最小墨迹内距 6 px，控件裁切与允许区外变化均为 0。4 项受保护输入拒绝。合版新增 4 张 A4、6 条带二维码记录、48 条裁线，框外墨迹为 0。既有 10 张封面、84 个索引行、113 张正文、8 张 QR 盖章页也通过。[像素清单](../../test-results/m13-evidence/qa-pixels-manifest-verification.json) |
| 构建与发布校验 | 默认构建和 `SITE_URL=https://release.arabiform.test` 的 `--strict-origin` 均通过，已重建并复验默认入口。五条静态路由共用 `index-CHC3AMe_.js`，275,520 B raw、86,909 B gzip，分别低于上限 4,480 B、591 B。已核对许可清单、CI、站点地图、robots、CSP 和 `connect-src 'none'`。[默认构建文件](../../test-results/m13-evidence/qa-static-files.json) · [严格域名校验](../../test-results/m13-evidence/qa-strict-release.log) |
| 浏览器 | Edge 单执行者、零重试。按原文件、测试 ID、标题及浏览器项目比对，102 个原有场景完整保留，新增 8 项。桌面和手机各通过 55 项，共 8.8 分钟。[完整运行日志](../../test-results/m13-evidence/qa-edge.log) · [逐例 JSON](../../test-results/m13-evidence/qa-edge-report.json) |

像素命令首次在 tsx 初始化时返回 `uv_os_get_passwd ENOMEM`。保留启动日志后，获准在相同提交、D 盘输入和临时目录下重新运行原命令，pdf-lib 与 PyMuPDF 均退出 0。[原始错误](../../test-results/m13-evidence/qa-pixels-sandbox.log) · [本机复跑](../../test-results/m13-evidence/qa-pixels-native.log)

## 从工作表到实际导出

同一 Excel 的 SHA-256 为 `991b9f111f02daa71cd8af53ee88f2674374731714279592f6da8e7a8f693863`。首次上传选中 Summary，选项仅包含 Summary 和 Roster_AR。切到名单后，在界面编辑器和实际可编辑 PDF ZIP 中逐行核对了姓名与原始编号。第二行的 Excel 数值按五位格式保留为 `00007`，第三行保留公式缓存值 `Approved` 和来源提示。[合成工作簿](../../fixtures/m13/multi-sheet-roster.xlsx) · [实际可编辑 ZIP](../../test-results/m13-evidence/qa-browser/desktop/editable/arabiform-clean.zip)

| 名单行 | 阿文姓名 | ID | 封面物理页 | 从纸面解出的 QR |
|---:|---|---|---:|---|
| 1 | ليلى حسن | `00123` | 2 | `CERT-00123` |
| 2 | أحمد سالم | `00007` | 2 | `CERT-00007` |
| 3 | بَنِي يَمَن | `00042` | 3 | `CERT-00042` |

将首行改为 `00456` 后保存草稿。切到 Summary 时，旧导出指纹清除，跨表草稿被拒绝。切回 Roster_AR 首行恢复 `00123`。随后导入匹配草稿，才恢复 `00456`。两张显式选择的工作表保有同一工作簿哈希与不同的 `sheetName`。未手动切表时沿用旧版来源清单格式，首张可见表由原始字节和默认选择规则确定。草稿始终保存工作表名，既有审计字段逐项核对不变。阿语界面还上传了首张可见表含重复表头的工作簿，显示错误并停用来源下载后，可切换到有效表继续。[名单草稿](../../test-results/m13-evidence/qa-browser/desktop/draft/arabiform-batch-draft.json) · [Summary 来源收据](../../test-results/m13-evidence/qa-browser/desktop/summary/arabiform-custody-manifest.json) · [Roster_AR 来源收据](../../test-results/m13-evidence/qa-browser/desktop/switched-back/arabiform-custody-manifest.json)

## 真实打印、预设与双语界面

使用带偏移 CropBox 和 90° 页旋转的单页模板。为同三行下载 1-up 参照、2-up 双语封面版和关闭水印与二维码的对照。逐页比较封面像素完全一致，英阿两栏均有字形。两张 A4 正文分别包含 16 和 8 条 0.35 pt 裁线，每个角两条，空槽没有裁线或墨迹。每行画面与带相同设置的 1-up 参照对齐，三行的深色采样均为零缺失、零多余，阿文水印均有实绘像素。读取器从 4 倍栅格取样，校验静区、格式字、纠错码和实际载荷。[桌面实际 2-up](../../test-results/m13-evidence/qa-browser/desktop/print/two-up/arabiform-merged.pdf) · [同设置 1-up](../../test-results/m13-evidence/qa-browser/desktop/print/one-up/arabiform-merged.pdf) · [手机逐行收据](../../test-results/m13-evidence/qa-browser/mobile/print/physical-proof.json) · [两视口独立复读与哈希](../../test-results/m13-evidence/lead-2up-edge-final.json)

界面导出并重新导入 v8，恢复 2-up、双语封面、阿文水印及指定二维码。逐份载入 v1–v7 均恢复 1-up。1-up 继续按已启用的旧功能选择兼容预设版本。替换为两页模板时，选择框禁用、显示 1-up 和单页限制，实际产物为 1 张封面加 6 张正文。换回单页后恢复配置的 2-up。[导出的 v8 预设](../../test-results/m13-evidence/qa-browser/desktop/preset/arabiform-mapping-preset.json) · [多页回退产物](../../test-results/m13-evidence/qa-browser/desktop/multi-page/arabiform-merged.pdf)

3,931 个本地请求中，外部请求、WebSocket、HTTP 错误、控制台或运行时错误均为 0。两个视口的英阿入口在选文件前各只取原始入口 JS，PDF、二维码和字体 JS 空载请求均为 0。手机页宽实测 390 px。运行结束后 4194 端口已关闭。[完整网络、哈希及视口收据](../../test-results/m13-evidence/qa-edge-summary.json)

首次桌面截图显示长选项末尾被遮住。修复后，英文选项实测 258.84 px，在桌面和手机预留箭头后分别有 278.32 px 和 300.32 px。该缺口按本周期记一次，已晋级的 Windows 像素复跑经验累计八个周期。[修复前截图](../../test-results/m13-evidence/lead-2up-select-before.png) · [桌面控件测量](../../test-results/m13-evidence/qa-browser/desktop/native-layout-en.json) · [经验记录](../../LESSONS.md)

三张截图均来自真正的 Edge 操作。英文桌面保留从工作表到拼版设置的连续原始画面，宽 1440 px、高 1222 px。另两张保留完整的桌面或手机视口。[桌面英文工作表与拼版](screenshots/m13/desktop-m13-xlsx-sheet-and-2up.png) · [阿语 RTL](screenshots/m13/desktop-m13-ar-rtl-2up.png) · [390 px 手机](screenshots/m13/mobile-m13-2up.png)
