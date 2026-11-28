# ArabiForm 2.6.0 独立验收

2026-11-28 在冻结主线 `89de0113de567f00bf1ec8e11bb2db510f3778b8` 验收通过。工作台可给名单任意列添加六类校验，错误行在打印前拦下，改正后即可导出。本地 CLI 可载入同一份 v13 预设。287 项单测、53,296 个固定种子样本、91 份四倍像素对照及 196 项真实 Edge 场景全部通过。遇到相邻换位后校验和仍成立的 IBAN，队列会保留该行，并提示核对原始凭据。[冻结版本与正式回执](../../test-results/m26-evidence/qa-main/formal-summary.json) · [主执行端独立复算](../../test-results/m26-evidence/lead-frozen-recount.json)

## 工资表如何阻断错误并恢复打印

英文和阿语工作台打开合成工资表示例后，三行中只有第 1 行就绪。第 2 行的 IBAN 末位从 `1` 误写成 `2`，第 3 行填了 `2026-02-29`。队列标出各自的列名、规则和该语言的原因，CSV 和 JSON 保留同一行号及两种语言的完整原因。把第 3 行改成 `2026-04-31` 仍被拦下。这时下载的可编辑 ZIP 只有 `0012345678.pdf`，合并 PDF 也只有一页。在旧预设下预先勾选错误行，再恢复带校验的 v13 预设，下载包仍只含合格行。[浏览器验收代码](../../tests/e2e/m26-validation.spec.ts) · [英文桌面](screenshots/m26/desktop-m26-validation-en.png) · [阿语桌面](screenshots/m26/desktop-m26-validation-ar.png) · [阿语手机](screenshots/m26/mobile-m26-validation.png)

在队列把 IBAN 改成 `SA31 0000 0000 0000 0001 0001` 后，第 2 行立即就绪。将第 3 行日期改成 `2026-04-30` 后，三行均可打印。桌面和手机的英阿界面分别下载、拆包再打开每份 PDF，逐项读回带空格的 IBAN、日期、十位前导零工号和含附标的阿语姓名。四次浏览器下载都经 PyMuPDF 四倍实绘，每次核对三份可编辑表单、12 个着墨控件与三页合并版，边缘裁切和控件外像素变化均为零，合并版逐页像素相同。[浏览器实测回执](../../test-results/m26-evidence/qa-main/runtime/)

v13 预设下载后重新导入，四条规则及其设置逐项相同。导入 v1 和 v12 时三行都恢复原有行为。另用较早的混合控件表单，在未映射至 PDF 的 `Gate` 列添加允许列表。一个不合格值拦下对应行，改为带首尾空格的允许值后，两份 PDF 均可下载。`Sentinel` 在两份 PDF 中保留 `KEEP 00109` 及原有外观流字节。导入引用缺失列的 v13 时，规则继续显示，两行都不能打印。[预设与未映射列断言](../../tests/e2e/m26-validation.spec.ts)

## IBAN 能验证的改动

独立取余程序检查了 16 个支持国家的结构与长度，并在其中 10 个国家的合成号码上穷举单个数字改成其他数字及交换相邻不同字符。166 个可接受样本的检查中，30,816 次数字改动、3,738 次相邻换位和 32 次删增长度均被拦下。沙特合成样本中的 `B1` 与 `1B` 都展开成 `111`，两个方向的号码都符合结构且 Mod-97 余数为 1。启用 IBAN 规则后，两行都收到 `iban-ambiguous-transposition`，提示用户核对原凭据。不同类别的单字符替换也有余数相同的反例，因此数字替换的结论只适用于数字改为另一数字。[独立取余结果及反例](../../test-results/m26-evidence/lead-iban-model.json) · [实际队列与审计](../../tests/e2e/m26-validation.spec.ts)

## 原生命令行与像素

冻结主线用本机 Node 执行三次 CLI。四行合成名单有一行合格，另三行分别含 `2026-04-31`、一位 IBAN 错误、`2026-02-29`。带 v13 预设的 `fill --strict` 退出 2，输出文件数为零。独立运行 `preflight` 也退出 2，写出 CSV 和 JSON，三个诊断的行号、列名、规则、原因码及双语原因逐一一致。修复后严格填充退出 0，产出四份可编辑 PDF、四份压平 PDF 和四页合并文件。主执行端另跑八次 CLI，覆盖仅输出合格行、开启掩码及旧预设的路径。[独立三次原生回执](../../test-results/m26-evidence/qa-main/cli-native/receipt.json) · [主执行端八次交叉复核](../../test-results/m26-evidence/lead-cli-roster/receipt.json)

PyMuPDF 1.26.7 四倍验收保留 M25 的全部 88 个标签，增至 91 个，所有样本的裁切像素和控件外变化均为零。新增三份工资表覆盖正常和修复后的姓名、IBAN、日期及工号，共 12 个着墨控件。四份既有公开表单和一份 CFF 字体均使用原来固定的字节。[逐样本实测](../../test-results/m26-evidence/qa-main/pixels-manifest-verification.json) · [五个输入指纹](../../test-results/m26-evidence/qa-main/pinned-inputs.json)

## 测试与发布构建

类型检查通过。默认单元测试 35 个文件、287 项全部通过，用时 680.23 秒。单独运行的 82 项固定种子测试用时 659.44 秒，种子为 1243704626，接受 53,296 例，较 M25 增加 2,550 例，零丢弃、零失败。预设的随机测试对 v1 至 v11 各作完整序列化往返，另对 v12、v13 随机组合精确位数、允许列表和拼版设置。大型用例显式超时下限为 180,000 毫秒。35 份合成夹具逐字节复现，夹具属性文件的 Git 对象为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[完整单元测试](../../test-results/m26-evidence/qa-main/unit.log) · [逐项固定种子结果](../../test-results/m26-evidence/qa-main/fuzz.log) · [夹具复现](../../test-results/m26-evidence/qa-main/fixtures.log)

默认来源、严格来源 `https://arabiform-qa.test` 和恢复默认来源后的三次构建均通过发布校验，各有五个静态路由，最大入口 JS 为 273,345 字节，gzip 后 85,016 字节。严格检查默认占位域名按预期退出 1。校验同时检查 sitemap、生产响应头、`connect-src 'none'`、第三方许可和 CI 配置。[严格来源通过](../../test-results/m26-evidence/qa-main/verify-strict.log) · [占位来源被拒](../../test-results/m26-evidence/qa-main/verify-strict-negative.log) · [默认来源已恢复](../../test-results/m26-evidence/qa-main/verify-restored.log)

沙箱中的 tsx 启动时报告 `uv_os_get_passwd ENOMEM`，正式 CLI、默认单元测试和像素套件改以本机 Node 执行。专项核对时将 CLI 标准输出中附加的 `outputs` 与实际文件名逐个对照，持久化 JSON 和 CSV 则核对同一组诊断。浏览器导出的预设对模板中保留的 `Sentinel` 显式写出空映射，导出后复导的完整预设相同。[初次沙箱日志](../../test-results/m26-evidence/qa-focused/sandbox-cli-native/held.stderr) · [专项复跑](../../test-results/m26-evidence/qa-focused/edge-results.json)

## 真实 Edge 回归

Microsoft Edge 124.0.2478.80 串行运行 21 分 0.35 秒，桌面 1440 × 900 和手机 390 × 844 各通过 98 项，无跳过、重试或不稳定用例。按测试 ID、视口、文件名和标题比对，M25 实跑清单和 M26 开始前保存的清单均有 188 项，冻结版本完整保留，增加的 8 项均为本版工资表、预设和校验场景。196 份运行记录共计 13,440 个本地请求，外部请求、WebSocket、浏览器错误、页面水平溢出均为零，测试进程退出后端口 4187 已关闭。[Edge 原始报告](../../test-results/m26-evidence/qa-main/edge-results.json) · [旧场景清单](../../test-results/m26-evidence/e2e-baseline-list.json) · [逐例网络和尺寸](../../test-results/m26-evidence/qa-main/runtime/)

八个新增场景在空闲工作台均只请求一个入口 JS。阿语界面使用同源字体。展开校验面板后才加载该面板脚本。检查可访问名称、原生控件的实际绘制和可见键盘焦点后，文字、控件边界、焦点环的最低对比分别为 5.647∶1、3.206∶1、5.882∶1。英阿界面打开新增规则编辑器后，焦点移到列选择框。阿语界面逐字符测量既有 `(.eml)` 的实际坐标，括号、点号与字母保持从左至右。手机上也能完整读出选中行的 IBAN 诊断、直接修改的输入框及当前可打印行数。[浏览器断言](../../tests/e2e/m26-validation.spec.ts) · [阿语手机截图](screenshots/m26/mobile-m26-validation.png)
