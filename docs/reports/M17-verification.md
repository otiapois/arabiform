# ArabiForm v1.7.0 本机独立验收

M17 通过本机验收。四种双语模板均可生成和下载，实际打印件的 QR 能读回对应记录，同名 PDF 改动一个字节即可检出。真实 Edge 134/134 项通过，保留原有 130 项。30,180 个对抗案例全部接受，65 次 PDF 填充的 4 倍实绘均无裁切和框外变化。入口 gzip 为 86,916 B，距上限还剩 84 B。[正式命令与退出码](../../test-results/m17-evidence/qa-formal.json) · [浏览器收据](../../test-results/m17-evidence/qa-edge-summary.json)

2026-11-27，独立 QA 在干净主线 `fd7cf2db356be50f3ddbac5e2260b42091d8fecc` 上顺序完成全部门禁。生产构建、公开测试样本、缓存、下载与原始回执均保存在 D 盘。版本为 1.7.0，沿用仓库锁定的依赖和本机 Edge。[任务与验收范围](../tasks/M17-bilingual-template-studio-qr-verifier.md)

## 可复现的使用路径

在本机生产构建的英文首页和阿语 `/ar/pdf-mail-merge`，以已安装的 Microsoft Edge 124.0.2478.80 分别测试 1440 × 900 桌面和 390 × 844 触屏模拟视口。进入工作台时默认打开 Fill PDFs。操作前两条路由都只请求一份入口 JavaScript。阿语界面另外请求两份本地排版字体 Noto Naskh Arabic 和 Noto Sans。PDF 引擎、QR 与字体处理 JavaScript 均在操作后加载。[任务书](../tasks/M17-bilingual-template-studio-qr-verifier.md) · [浏览器实测](../../tests/e2e/m17-studio-verifier.spec.ts)

在 Create template 中设置机构名「مدرسة النور / Noor School」、双语副标题与藏青色，分别打开结业证书、人事证明、诊所同意书、A6 访客证。四类预览均有纸面与墨迹。逐个下载可编辑 PDF 和标为合成样本的配套 CSV，PDF 的 5、6、5、4 个字段分别与对应 CSV 的表头吻合。四份 PDF 内容流均保留了自定义机构名和副标题。[英文桌面](screenshots/m17/desktop-m17-template-studio-en.png) · [阿语桌面](screenshots/m17/desktop-m17-template-studio-ar.png) · [阿语移动视口](screenshots/m17/mobile-m17-studio.png)

将结业证书交给 Use in Fill PDFs Now，再上传姓名为「لَيْلَى سَالِم」和「Maya Reed」的两行 CSV。预检两行均通过。可编辑 ZIP 的两份 PDF 读回了完整姓名、`00123` 和 `00007` 以及各自的复选框状态。选择交接记录 QR 并导出可编辑 ZIP 后，其清单没有已印记录。勾选压平再下载 ZIP，两张打印页均无表单树和可交互控件，清单列出对应两行。

独立计算原模板、名单和输出 PDF 的 SHA-256，再用模板摘要、名单摘要和工作表名计算批次前缀。对实际 ZIP 两页做 PyMuPDF 4 倍渲染，与可编辑页比较印章区域以外的所有像素。从每页印章的 25 × 25 个模块中心取样，读取格式位，验证纠错码并解出完整的 `ARABIFORM:1:<12 位十六进制前缀>:<原始行号>`。两行均有完整的四模块静区。主执行端另行打开四组正式下载，逐个重算两个 ZIP 中共 16 个成员 PDF 的摘要，并核对 8 张实际盖章页。[正式下载的独立复算](../../test-results/m17-evidence/lead-final-edge-readback.json) · [像素取样](../../tests/e2e/m17-printed-qr.py) · [独立 QR 解码](../../tests/core/qr-proof.ts)

在 Verify receipt 中上传本次下载的交接清单。原文件返回 `VERIFIED_EXACT_MATCH`。同名文件只翻转一个字节后返回 `TAMPERED_BYTE_MISMATCH`，界面同时显示实算和清单中的完整摘要。把改动文件换成未列名的文件，得到 `UNMATCHED_UNKNOWN`。粘贴印刷记录得到 `VERIFIED_QR_RECORD`。改批次前缀、改为未列出的第三行，或换用可编辑导出时的清单，均得到 `UNMATCHED_UNKNOWN`。这些结果以用户提供的未签名清单为参照，无法独立确认签发者身份。[四种结果同屏](screenshots/m17/desktop-m17-custody-verifier.png)

## 验收中发现的两处实绘缺陷

- 人事证明的一版压平输出改变了日期字段 `StartDate` 区域的 901 个像素。修正控件的非整数坐标与外观放置后，四类模板在可编辑页与压平页之间的像素差均为 0，加盖 QR 后的框外差也均为 0。[修复前的定位](../../test-results/m17-evidence/worker-a/starter-flatten-parity-red.json) · [逐模板复验](../../test-results/m17-evidence/lead-studio-final/flatten-isolation.json)
- 阿语界面的 PDF.js 画布继承 RTL 方向，证书英文标题中的字母在预览里发生重叠。相同的下载文件在本机 PDF 渲染器中显示正常。给 PDF 绘图画布显式设置 LTR 后，桌面和移动两种视口下，内部 760 × 538 画布的英阿 RGBA 摘要均为 `4b26d5954187c12e5bccb29d669585848699668ca2330c99f2040fe3bd3d349b`。阿语页面布局保留从右到左的阅读顺序。[修复前的阿语画面](../../test-results/m17-evidence/qa-rtl-preview-red/desktop-m17-template-studio-ar.png) · [修复前的断言](../../test-results/m17-evidence/qa-focused-rtl-red.log) · [修复后回归](../../test-results/m17-evidence/qa-focused-green-summary.json)

M16 已隔离的扩展名在本次修复前仍按 LTR 显示。M17 实际发现的是阿语说明的句点贴住了 `_Ungrouped` 的下划线。390 px 屏上，句点的右边界和下划线左边界同为 286.641 px。修复后，句点与文件夹名分别在上一行和下一行。另用 DOM Range 回归拆分 ZIP、交接清单和保存／载入草稿控件，两个视口的扩展名都从左到右显示左括号、点、字母和右括号。`_Ungrouped` 的说明句在文件夹名前独立结束，普通 ZIP 和 JSON 下载按钮保留原有可访问名称。RTL 扩展名检查累计四个里程碑，压平前后整页像素检查累计三个，均已纳入代码标准。[句点修复前](../../test-results/m17-evidence/worker-b/before.log) · [修复后](../../test-results/m17-evidence/worker-b/after.log) · [经验记录](../../LESSONS.md) · [代码标准](../code-standards.md)

## 正式门禁与证据

| 检查 | 实测结果 |
| --- | --- |
| 类型、单元测试与夹具 | `npm run typecheck` 通过。`npm test` 完成 24 个文件的 177 项测试。只读复验 24 个合成夹具，`fixtures/.gitattributes` 的 Git 对象仍为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[单元测试](../../test-results/m17-evidence/qa-unit.log) · [夹具](../../test-results/m17-evidence/qa-fixtures.log) |
| 对抗测试 | 种子 `1243704626`，50 项属性共接受 30,180 例，丢弃 0，失败 0。原来的 27,680 例之外，每种模板另有 625 例，逐例走生成、检查、实际填充、提取、归档与单字节篡改校验。优化后复用同一份已填 PDF 做提取和打印归档。四组分别耗时 60.27、58.64、61.72、57.73 秒，独立 fuzz 命令总耗时 292.64 秒。[完整运行](../../test-results/m17-evidence/qa-fuzz.log) · [独立计数](../../test-results/m17-evidence/qa-fuzz-recount.json) |
| 双引擎 PDF 实绘 | pdf-lib 回读与 PyMuPDF 1.26.7 的 4 倍渲染覆盖 65 次填充、202 个有墨迹控件。裁切与已映射控件之外的像素变化均为 0。四类新模板各有带音标阿语和英语两次填充，四角最多 72 pt 印章净空及 9 pt 上下页边距均通过。12 张盖章页共核对 10,988 个模块，12 张 A4 拼版核对 21 条记录。保留的四份公开样本中三份可填，W-9 因含 XFA 如期拒绝，同时覆盖自定义 CFF 字体。[完整像素报告](../../test-results/m17-evidence/qa-pixel-output/manifest-verification.json) |
| 界面对比度 | 两个新增面板的英／阿和桌面／移动组合中，已测文字的最低对比度为 5.64:1，控件视觉提示为 3.20:1，焦点轮廓为 5.88:1。该抽测覆盖了控件命名、地标与状态播报。[逐视口测量记录](../../test-results/m17-evidence/worker-b/smoke-exact.log) |
| 静态发布 | 五条规范路由、五份静态 HTML 共享一个入口，原始 276,456 B、gzip 86,916 B，距上限分别为 1,544 B 和 84 B。默认来源和独立严格来源均通过，占位来源用于严格验证时按预期拒绝。恢复默认构建后再次通过。检查包括 `connect-src 'none'`、站点地图、重定向、许可告知、字体许可与 CI。[静态清单](../../test-results/m17-evidence/qa-static.json) · [严格来源](../../test-results/m17-evidence/qa-strict-release.log) · [占位来源负例](../../test-results/m17-evidence/qa-default-reject.log) · [恢复后](../../test-results/m17-evidence/qa-restored-release.log) |
| 真实 Edge | 保留串行配置，134 项一次通过，桌面与移动各 67 项，全程 906.6 秒。通过文件、用例 ID、标题及项目四项比对，原 130 项全部保留。6,498 个 HTTP 请求均为本地请求，外联、WebSocket 与浏览器错误各 0。新流程在冷启动、模板预览、填充与验真结果处均未测得页面横向溢出，测试结束后端口 42885 已关闭。[原始浏览器日志](../../test-results/m17-evidence/qa-edge.log) · [运行汇总、下载位置与截图哈希](../../test-results/m17-evidence/qa-edge-summary.json) |

Windows 沙箱首次执行 `npm run verify:pixels` 时，tsx 在用户目录解析处返回 `uv_os_get_passwd ENOMEM`。使用同一提交、同一 D 盘输入与临时目录，在获准的本机环境重跑原命令，退出码为 0。[启动错误](../../test-results/m17-evidence/qa-pixels.log) · [本机结果](../../test-results/m17-evidence/qa-pixels-native.log)
