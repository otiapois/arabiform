# ArabiForm 2.7.0 独立验收

2026-11-28，冻结主线 `d7f908bf0eddef2cb3187714065455fde7f3a793` 通过独立验收。工作台和离线 CLI 都能比较两批 PDF，列出修改、新增、移除及相同的文件，并只打包需要重印的 PDF。两份证书中修正一份的演示实际只重印一页，节省 50%。296 项单测、55,796 个固定种子样本、91 份既有表单四倍像素对照、新增双语摘要及 204 项真实 Edge 场景全部通过。[冻结版本与全套回执](../../test-results/m27-evidence/qa-main/formal-summary.json) · [主执行端独立复算](../../test-results/m27-evidence/lead-frozen-recount.json)

## 哪些文件需要重印

在英文和阿语工作台打开 “Compare batches” 的合成示例，周一与周二各有两份单页证书。第一份的完整 PDF 字节相同。第二份 `certificates/record-002.pdf` 的 `NameAr` 从 `سارة أحمد` 改成 `سارة محمد`，`Verified` 从 `Off` 改成 `Yes`。两个字段的保存值位于控件的父字段。用 PyMuPDF 从 `/V` 直接读回，与界面上分列显示的旧值、新值及两份审计逐项一致。选择“已修改”后，表中只剩第二份证书。下载的增量 ZIP 也只有这份 PDF，路径及字节均与周二原件一致。两页重印一页，节省 50%。[桌面英文](screenshots/m27/desktop-m27-batch-diff-en.png) · [桌面阿语](screenshots/m27/desktop-m27-batch-diff-ar.png) · [阿语手机](screenshots/m27/mobile-m27-batch-diff.png)

通过文件选择框另行上传一对合成 ZIP，包含同名同字节的文件、两份变动文件、一份新增文件和一份移除文件。其中一份无表单字段的 PDF 从一页变两页，界面提示核对视觉或压平变化。新批次共 6 页，重印包内的三份 PDF 共 5 页，纸面与屏幕都显示节省 16.67%。把同一份新批次送入两个文件框，4 份文件全部相同，增量 ZIP 为空，节省率 100%。已有成功结果时，分别替换任一侧为损坏文件，四个下载入口立即消失。重新比较会标出对应文件框并给出当前语言的原因。[Edge 操作与断言](../../tests/e2e/m27-batch-diff.spec.ts) · [独立文件读回](../../tests/e2e/m27-download-proof.py)

每组成功比较均实际下载 ZIP、CSV、JSON 和双语摘要 PDF。Python 用 `zipfile` 检查归档，再把解压后的每个成员与新批次逐字节比较。CSV 和 JSON 的两个输入 ZIP 指纹、输出 ZIP 指纹、每个成员的 SHA-256、状态、原始字段值和页数均核对实际文件。摘要按单面打印、每页一张纸计算。PDF 渲染到 4 倍后，两栏各有 10 行着墨内容，对应行垂直相交，中缝留白。演示页尺寸为 2382 × 3368 像素，四边着墨留白依次为左 168、上 255、右 169、下 971 像素。[正式浏览器下载](../../test-results/m27-evidence/qa-main/runtime/) · [独立打印检查](../../tests/e2e/m27-download-proof.py)

## 完整测试和真实浏览器

类型检查通过，默认单测 36 个文件、296 项全部通过，用时 898.92 秒。单独运行的 85 项属性测试用时 859.32 秒。固定种子 1243704626 接受 55,796 例，较 M26 增加 2,500 例，零丢弃、零失败。新增属性覆盖相同或重新压缩的批次、单个阿语字符或勾选值的变动、增量成员的精确字节和受损输入。大型用例显式超时下限为 180,000 毫秒。[单测原始结果](../../test-results/m27-evidence/qa-main/unit.log) · [逐属性种子测试](../../test-results/m27-evidence/qa-main/fuzz.log)

Microsoft Edge 124.0.2478.80 串行运行约 25 分钟，桌面 1440 × 900 和手机 390 × 844 各通过 102 项。按测试 ID、项目、相对文件名和标题逐项比对，既有 196 项与 M26 实跑及本次开工清单完全相同，新增的 8 项均来自 M27。所有用例各运行一次，无跳过、重试或不稳定用例。204 份运行记录共有 14,425 个本地请求，外部请求、WebSocket、浏览器错误与页面水平溢出均为零。[Edge 原始报告](../../test-results/m27-evidence/qa-main/edge-results.json) · [开工前的 196 项清单](../../test-results/m27-evidence/e2e-baseline-list.json) · [逐例网络与尺寸](../../test-results/m27-evidence/qa-main/runtime/)

初次打开首页和 `/ar/pdf-mail-merge` 时，两种视口都只请求一个入口 JS。阿语额外读取两款同源页面字体。用于 PDF、QR、字体嵌入和批次比较的 JS 均延迟加载。修复后单独打开提取工具只取 `PdfExtractor` 和 `Filename`，打开 CLI 帮助只取 `LocalCliCommand`。新比较面板有数据时，文字、控件边界和键盘焦点环的最低对比分别为 5.568∶1、3.206∶1 和 5.882∶1。阿语界面分别在两个上传标签和四个下载按钮逐字符实测括号、点和扩展名，均保持从左到右的坐标顺序。[M26 与 M27 空载请求](../../test-results/m27-evidence/qa-main/idle-comparison.json) · [最终工具激活请求](../../test-results/m27-evidence/qa-main/restored-tool-activation.json)

文首三张图来自专项验收。最终全量运行重新截图并逐张查看，窗口取景略有上下差异，两组图都能完整读到 50% 节省和两处字段变更。[最终英文桌面截图](../../test-results/m27-evidence/qa-main/runtime/m27-batch-diff-M27-en-Mond-30b2f-ers-four-verified-artifacts-desktop/screenshots/desktop-m27-batch-diff-en.png) · [最终阿语桌面截图](../../test-results/m27-evidence/qa-main/runtime/m27-batch-diff-M27-ar-Mond-39944-ers-four-verified-artifacts-desktop/screenshots/desktop-m27-batch-diff-ar.png) · [最终手机截图](../../test-results/m27-evidence/qa-main/runtime/m27-batch-diff-M27-ar-Mond-39944-ers-four-verified-artifacts-mobile/screenshots/mobile-m27-batch-diff.png)

## 命令行和受损输入

在冻结主线上直接启动七次本机 CLI。演示比较和同批次比较都退出 0，各产生四个文件。含父目录段、重复文件名、非 PDF 成员、PDF 内容不可读和 ZIP 容器损坏的五次比较均退出 2，输出文件数为零，诊断注明是哪一批和哪一层出错。主执行端另行验证了重新压缩、Unicode 路径、空批次、压平页及交叉引用损坏的 PDF 等样本，七次成功，十一次拒绝。修复前，PDF 读取库能恢复交叉引用位置错误的输入。修复后该文件在 PDF 层收到 `invalid-pdf`。正式验收保留了修复前后的原始记录。[独立七次 CLI](../../test-results/m27-evidence/qa-main/cli-native/receipt.json) · [主执行端十八次复核](../../test-results/m27-evidence/lead-diff-cli/receipt.json) · [初次失败](../../test-results/m27-evidence/worker-core/m27-xref-red.log) · [修复后](../../test-results/m27-evidence/worker-core/m27-xref-green.log)

## 像素、夹具与构建

PyMuPDF 1.26.7 逐项保留前版 91 个表单样本标签，检查 274 个带墨迹的控件，裁切像素和控件外变化均为零。17 张合并页、8 张压平 ZIP 页逐像素相同。M27 新增的一页英阿摘要在清单中单独计数，十对双语行均着墨，页面裁切为零。四份公开 PDF 和一款 CFF 字体的 SHA-256 与基线一致。37 份合成夹具逐字节复现，原夹具属性文件的 Git 对象仍为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[逐样本报告](../../test-results/m27-evidence/qa-main/pixels-manifest-verification.json) · [五项输入指纹](../../test-results/m27-evidence/qa-main/pinned-inputs.json) · [夹具复现](../../test-results/m27-evidence/qa-main/fixtures.log)

默认来源、严格来源 `https://arabiform-qa.test` 和恢复默认后的三次构建均通过发布检查。严格检查默认占位来源按预期退出 1。五条静态路由分别测得初始 JS 为 263,949 字节，gzip 后 82,468 字节，较 M26 分别减少 9,396 和 2,548 字节。响应头保留 `connect-src 'none'`，发布检查同时覆盖 sitemap、第三方许可与 CI。[五条路由的入口](../../test-results/m27-evidence/qa-main/entry-per-route.json) · [严格来源](../../test-results/m27-evidence/qa-main/verify-strict.log) · [占位来源被拒](../../test-results/m27-evidence/qa-main/verify-strict-negative.log) · [恢复默认](../../test-results/m27-evidence/qa-main/verify-restored.log)

首次冻结提交 `493424f` 跑完桌面 102 个场景后，有四个英阿用例报告加载了额外脚本。在提取工具和本地 CLI 帮助中分别观察到多余的 `UtilityModes` 和 `DeferredFillView`。修复时把对应操作接回各自的加载入口，并把 QR 打印校验延迟到实际启用 QR 时再加载。四项旧断言保留原样。旧运行在桌面回执存档后结束，端口 4187 随即关闭。修复后的专项回归通过了 10 个 Edge 场景和 21 项 QR 等相关单测。[首次桌面回执](../../test-results/m27-evidence/qa-main/first-493424f/desktop-discovery.json) · [旧进程退出](../../test-results/m27-evidence/qa-main/first-493424f/teardown.json) · [修复后 Edge](../../test-results/m27-evidence/worker-web/m27-lazy-regression-edge-final.log) · [QR 回归](../../test-results/m27-evidence/worker-web/m27-lazy-regression-qr.log)

首次冻结提交上，沙箱中的 tsx 在执行业务代码前返回 `uv_os_get_passwd ENOMEM`。使用同一冻结提交、命令、D 盘输入和临时目录，本机复跑通过 CLI 与像素检查。首轮专项 Edge 的两个阿语用例在测量扩展名时遇到分段文本节点。测量代码改为逐节点读取括号、点号与字母的实际字形位置，英阿桌面和手机八个场景全量复验通过。[CLI 启动日志](../../test-results/m27-evidence/qa-main/sandbox-cli/clean.stderr) · [像素启动日志](../../test-results/m27-evidence/qa-main/sandbox-pixels/pixels.log) · [专项首轮](../../test-results/m27-evidence/qa-focused/first-edge/edge-results.json) · [八项复验](../../test-results/m27-evidence/qa-focused/edge-results.json)

## 主线收尾

已确认三个本机测试端口均关闭，删除 D 盘四个已合并的临时工作树和专用临时目录。Git 仅登记主工作树。冻结验收后提交的文件限于报告、复盘与项目规范。夹具属性哈希仍为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[实际清理回执](../../test-results/m27-evidence/lead-worktree-cleanup.json)
