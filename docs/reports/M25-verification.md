# ArabiForm 2.5.0 独立验收

2026-11-28 在干净主线提交 `00c0bf0f06b282396415f3238c9ff4fd6ef74feb` 完成验收。两种语言的离线草稿均附上本行实际下载的 PDF，脱敏预览与导出结果一致。单测 266/266，固定种子检查接受 50,746 例，四倍像素 88/88，真实 Microsoft Edge 188/188。原有 180 项 Edge 场景与两份历史基线逐项吻合。[冻结版本与全部命令收据](../../test-results/m25-evidence/qa-main/formal-summary.json) · [主执行端独立复算](../../test-results/m25-evidence/lead-frozen-recount.json)

## 离线邮件草稿

在英文首页和阿语工作台上传合成诊所表单，填入六行名单，按第 4、3、1 行的顺序勾选。实际下载的草稿 ZIP 和独立 PDF ZIP 都只包含第 1、3、4 行。两个阿语文件名去掉非法字符后同名，最终分别是 `ملفمشترك.pdf`、`ملفمشترك-2.pdf`，第三人收到 `Summary.pdf`。测试还切换为扁平 PDF，重新验证三位收件人、附件和清单。旧 CSV 在范围或附件设置改变后立即失效。[Edge 场景](../../tests/e2e/m25-dispatch.spec.ts) · [实际下载与浏览器收据](../../test-results/m25-evidence/qa-main/runtime/)

Python 标准库独立解析实际邮件。每份草稿只有一段双语纯文本和一份 PDF，读取的收件人、可选抄送人、UTF-8 主题、正文换行和原样保留的 `{{ID}}` 等单元格文字均与名单一致。长主题的编码词可分别解码，邮件使用 CRLF、正确折行、`MIME-Version: 1.0` 和 `X-Unsent: 1`。解码后的附件逐字节等于本行 PDF ZIP 成员。重新计算的 PDF 和 EML SHA-256 匹配 JSON 和 CSV，单独下载的 CSV 与包内 CSV 完全相同。清单也注明可编辑或扁平附件版本。[独立 MIME、CSV 和 SHA-256 检查](../../tests/e2e/m25-dispatch-proof.py)

原生 CLI 用两个地址生成四封测试邮件，覆盖普通与脱敏两批，以及一行有抄送、一行无抄送。其余 11 种合成输入在缺失或无效地址、收件人／抄送／主题／附件名称出现换行时均退出 2，逐项返回正确行号，输出文件数为 0。两行共用无效主题时，两行都进入诊断。此次测试只在本地解析草稿，邮件客户端打开和投递未实测。[13 次 CLI 回执](../../test-results/m25-evidence/qa-main/cli-native/receipt.json) · [主执行端独立复验](../../test-results/m25-evidence/lead-cli-verified/receipt.json)

## 脱敏与像素

在两个语言、两个视口中，将 ID `00518130` 设为保留末四位，再将阿语姓名设为全部遮盖。Edge 的实时画布只在当前字段框内改变。重新打开下载的可编辑 PDF，`/V` 和工作台的提取结果分别为 `****8130` 和十个星号，原模板字段 `KEEP 00109` 保留。把同样星号作为字面输入重新生成，画布和四倍渲染均逐像素相同。脱敏附件的清单和分类账写有 `redactedReview: true` 与 `ID`、`Name` 两个实际字段名。[双引擎对照](../../tests/e2e/m25-redaction-proof.py) · [阿语工作台真实画布](screenshots/m25/desktop-m25-redacted-ar.png)

PyMuPDF 1.26.7 四倍渲染保留前一版全部 87 个样本，本次增至 88 个。所有样本的边缘裁切和控件外像素变化均为 0。新增样本的姓名含阿语附标，ID 使用东阿拉伯数字，读取结果为 `****سَالِم` 和 `******٠٠٤٢`。两框的墨迹距离控件边缘均至少 12 个四倍像素，遮盖前缀命中为 0，编辑版与扁平版整页像素相同。四份外部 PDF 和一份 CFF 字体按固定指纹重验。[完整像素结果](../../test-results/m25-evidence/qa-main/pixels-manifest-verification.json) · [固定输入指纹](../../test-results/m25-evidence/qa-main/pinned-inputs.json) · [独立四倍渲染图](../../test-results/m25-evidence/lead-redacted-4x.png)

## 浏览器、构建与复跑

Microsoft Edge 124.0.2478.80 用一个 worker 串行运行 19 分 33.09 秒，桌面 1440 × 900 和手机 390 × 844 各通过 94 项，无跳过、失败或重试。188 份监控共记录 12,317 次本地请求，外部请求、WebSocket、控制台和页面错误均为 0。每例结束时都测量浏览器、文档和 body 宽度，水平溢出为 0。新增八个场景在两种语言的空闲页均只请求一个入口 JS，阿语页面使用本地 Noto 字体文件。对激活的工作台控件进行程序化检查，文字、控件边界及键盘焦点的最低对比分别约为 5.647∶1、3.206∶1、5.882∶1。阿语界面用 DOM Range 逐字符核对 `(.eml)`、`(.zip)`、`(.csv)`，括号和点号均按从左到右的顺序显示。验收结束后 4187 端口已关闭。[Edge 原始结果](../../test-results/m25-evidence/qa-main/edge-results.json) · [逐例网络和宽度](../../test-results/m25-evidence/qa-main/runtime/) · [英文桌面](screenshots/m25/desktop-m25-dispatch-en.png) · [阿语手机](screenshots/m25/mobile-m25-dispatch.png)

默认 `npm test` 通过 34 个文件、266 项测试，用时 567.94 秒。单独运行的 79 项性质测试使用固定种子 1243704626，接受 50,746 例，丢弃和失败均为 0，用时 459.53 秒。大型性质测试的超时下限为 180,000 ms。类型检查与 32 份夹具的逐字节复现均通过。夹具属性文件的 Git 对象为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[单测](../../test-results/m25-evidence/qa-main/unit.log) · [固定种子原始结果](../../test-results/m25-evidence/qa-main/fuzz.log) · [夹具复现](../../test-results/m25-evidence/qa-main/fixtures.log)

默认来源、严格来源 `https://arabiform-qa.test` 和恢复默认后的三次构建均通过发布校验。五个预渲染路由的最大入口 JS 为 272,338 字节，gzip 后 84,769 字节，均低于 274,000 / 85,800 字节的预算。严格来源检查正确拒绝默认占位域名。发布检查同时覆盖 sitemap、生产隐私响应头、第三方许可及 CI。[严格来源](../../test-results/m25-evidence/qa-main/verify-strict.log) · [占位域名拒绝](../../test-results/m25-evidence/qa-main/verify-strict-negative.log) · [恢复默认](../../test-results/m25-evidence/qa-main/verify-restored.log)

第一次聚焦运行把阿语页面的两个本地 CSS 字体也算进空闲脚本，并在重跑预检时截到模板过渡帧。改为逐个记录同源字体请求，只允许一个入口 JS，并在就绪行的实际 PDF 验值后采集画布。最终聚焦 8/8 通过。Windows 沙箱中 tsx 启动时报 `uv_os_get_passwd ENOMEM`。含 tsx 的 CLI、默认单测和像素验收使用本机 Node，临时目录、输入和回执均在 D 盘。[首次聚焦结果](../../test-results/m25-evidence/qa-focused/initial-results.utf16.json) · [修正后复跑](../../test-results/m25-evidence/qa-focused/edge-final.json) · [沙箱启动日志](../../test-results/m25-evidence/qa-focused/cli/valid.stderr)
