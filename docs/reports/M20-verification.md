# ArabiForm v2.0.0 本机独立验收

M20 通过本机独立验收。用户可以让同一行的 Notes 输出 `٠٠١٢٣`、ID 输出 `00123`，保存行距与内边距设置，并在预览、压平和打印时使用双语审批章。章与控件或 QR 相撞时，界面和 CLI 均阻止带章导出。冻结主线的单元测试 202/202、真实 Edge 150/150，固定种子测试接受 37,904 条。下文记录了PyMuPDF 1.26.7 对特定压平页抽取全文的限制。[正式门禁与命令](../../test-results/m20-evidence/qa-formal.json)

## 英文与阿语工作台

在英文首页与阿语 RTL 填表页分别上传同一份双页合成 AcroForm 与同一份 CSV。第一页为横式，第二页旋转 90°。Notes 第一行原值为 `00123`，第二行混合了三种数字字形。选择东方阿拉伯数字后，两行在可编辑 PDF 字段值与外观流中均为 `٠٠١٢٣`。ID 原值 `0۰1٢3` 按自己的设置转为 `00123`。下载成员仍名为 `Training/source-0۰1٢3.pdf`。未映射的 Sentinel 保留原始 `/V`、`/AP` 字典和压缩的外观流字节。[Edge 测试](../../tests/e2e/m20-typography-seal.spec.ts) · [专项数据](../../test-results/m20-evidence/qa-focused-proof-summary.json)

在同一行数据上先设行距 1、内边距 2 pt，再改为行距 1.3、内边距 6 pt，重新下载后逐一解析 PDF 外观。Notes 的外观框大小保持一致，两条基线的距离从 21.0 pt 增至 27.3 pt，首个字符的横坐标从 3 pt 变为 7 pt。ID 继续使用自己的设置。[英文桌面](screenshots/m20/desktop-m20-numerals-seal-en.png) · [阿语桌面](screenshots/m20/desktop-m20-numerals-seal-ar.png)

双语矢量章写入 `Training Office`、`مكتب التدريب`、`2026-11-28`，另在指定角位绘制 QR。章移至左上方时，提示栏指出占用该处的 Sentinel。移至左下方时，提示栏显示 QR 冲突。两种冲突均隐藏先前盖章的预览，禁止压平 ZIP、合并和分组打印，并保留可编辑 ZIP。移回右下方即恢复打印。从对应 PDF.js 画布的右下角取样，盖章后桌面与手机分别新增 2,048、842 个深色像素，清除后均为 0。旧 v1–v9 预设分别从文件导入，数字恢复保留原值、行距恢复 1、内边距随模板。重新导入 v10 恢复同一盖章画面，再导出得到相同 JSON。[手机实拍](screenshots/m20/mobile-m20-seal.png) · [双语与两种视口的实测](../../test-results/m20-evidence/qa-focused-proof-summary.json)

四组浏览器用例各下载了压平 ZIP、整批合并 PDF 和分组 ZIP，逐一打开这 12 份产物中的打印页面。每种输出的两页都保留 0°、90°，均写入了三个标签、两条边框与独立的矢量 QR。PyMuPDF 按 4 倍渲染这三种打印输出，对应整页像素完全相同。相对未填的源页，两页章区分别改变 14,797 个像素，两页 QR 区分别改变 13,348 个像素。四种语言与视口组合使用同一组源字节，其打印页面的像素哈希也逐页相同。[独立下载复核](../../test-results/m20-evidence/qa-focused-proof-summary.json)

## 冻结主线门禁

正式命令均在干净的物理主线 `D:\workspace\vibe_coding\sites\arabiform` 运行，冻结提交为 `75079b0fa7069ce58affb337822c5face033dcf8`。使用 Node 24.22.1 随附的 npm，依赖、夹具、运行缓存和临时文件都位于 D 盘。[命令、工作目录与退出码](../../test-results/m20-evidence/qa-formal.json)

| 检查 | 冻结版本的实测结果 |
| --- | --- |
| 类型、单元和夹具 | 类型检查通过，完整 Vitest 27 个文件、202 项通过。24 份合成夹具通过再生成比对。[单元日志](../../test-results/m20-evidence/qa-unit.log) · [夹具校验](../../test-results/m20-evidence/qa-fixtures.log) |
| 单独的固定种子模糊测试 | 种子 `1243704626`，37,904 条接受，0 丢弃、0 失败属性。保留旧 35,254 条，新增 800 条数字转换、650 条排版、650 条角位和碰撞、550 条预设及草稿。500 条封面排版、含 500 份实际打印的作业、重型 AcroForm 读写及 M20 的排版与碰撞用例均设独立 180 秒预算，四类各 625 份真实模板的测试为 300 秒。[独立计数及用例预算](../../test-results/m20-evidence/qa-fuzz-summary.json) |
| 原生 PDF | PyMuPDF 1.26.7 以 4 倍渲染 67 组填充结果，实绘边缘裁切和映射区域以外变化均为 0。保留四份公开表单的预期接受或拒绝结果、四类模板的八次填充。M20 的两页包括旋转 90°、UserUnit 为 2 的页面，两页均实测 14,886 个印章像素，控件重叠、二维码像素改变、章区外新增变化均为 0。实绘行距从 16.908 pt 增至 21.1416 pt，内边距分别增加 4.4 pt、2.8 pt。[实测数据](../../test-results/m20-evidence/qa-pixels-summary.json) · [完整像素报告](../../test-results/m20-evidence/qa-pixel-output/manifest-verification.json) |
| CLI | 将浏览器保存的 v10 预设直接传给 `--preset`。可编辑 ZIP、压平 ZIP、合并 PDF 和交接清单齐全。控件或 QR 占位时各退出 2，均未写入输出文件。成功导出的两页在 4 倍渲染下与浏览器下载的对应页面逐像素相同。另一组兼容性验证保留了 15 次 CLI 调用和旧格式输出的逐字节对照。[冻结主线 CLI](../../test-results/m20-evidence/cli-native-summary.json) · [版本兼容对照](../../test-results/m20-evidence/lead-native-a95660b/receipt.json) |
| 发布构建 | 默认构建、使用 `SITE_URL=https://release.arabiform.test` 的全新严格来源构建、恢复后的默认构建均通过。三次均为五个 HTML，sitemap 与相应来源一致。严格模式拒绝 `.example`。入口 272,897 字节，gzip 85,379 字节，分别比上限少 1,103 和 421 字节。生产 CSP 保留 `connect-src 'none'`。发布验证同时核对许可证声明与 CI；夹具属性文件的磁盘及 Git blob 均为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[默认](../../test-results/m20-evidence/qa-static-default.json) · [严格来源](../../test-results/m20-evidence/qa-static-strict.json) · [占位来源拒绝](../../test-results/m20-evidence/qa-placeholder.log) · [已恢复默认](../../test-results/m20-evidence/qa-static-restored.json) |
| 真实 Edge | Microsoft Edge 124.0.2478.80 单工作进程运行 17.4 分钟，1440 × 900 与 390 × 844 各 75 项，150/150 通过、零重试。按文件、ID、标题和项目与 M19 的实跑及本轮启动清单逐一核对，全部 146 个旧场景保留。监测到 8,718 个本机请求和 852 次 Worker 启动，外联、浏览器错误、WebSocket 均为 0。运行结束时 42926 端口已拒绝连接。[本轮原始报告](../../test-results/m20-evidence/qa-edge-report.json) · [基线核对与独立读回](../../test-results/m20-evidence/qa-edge-summary.json) |

四组 M20 浏览器场景的空载请求均仅有一份入口 JS，阿语页面另读两份本地显示用字体。PDF、QR、字体处理脚本的空载请求为 0。展开数字、排版和印章设置后，实测文字对比度最低为 5.568∶1、控件边界为 3.205∶1、键盘焦点环为 5.881∶1。390 px 手机视口、文档和正文宽度相同。最终三张双语截图均在冻结主线上重新拍摄，文件哈希与交付的 PNG 逐份一致。[网络、无障碍与图片哈希](../../test-results/m20-evidence/qa-edge-summary.json)

## 首次失败与适用边界

- 首次冻结在 `ff3e6c2e` 时，3 项既有浏览器导出单元测试发现，关章状态下提交给 Worker 的参数列表仍包含新加的空位置。主线调用中断后，专项重放 3 项均复现。修正恢复了已有无章调用的参数列表，保留原来的三个断言。专项另测真实启用章和异步准备期间设置已过期的调用，5/5 通过。[首次单元日志](../../test-results/m20-evidence/qa-first-ff3e6c2/qa-unit.log) · [原调用差异](../../test-results/m20-evidence/qa-focus-regression.log) · [修复后专项](../../test-results/m20-evidence/worker-b/legacy-arity-focused.log)
- 首版像素检查发现，未盖章时交互控件和压平页的抗锯齿已有 5,014、4,461 个像素差。检查器改为各自先与同类无章页比较，随后逐像素核对预览与打印的章区和 QR 区，并比较压平 ZIP 与合并件的整页。首版浏览器 QA 还采到了界面已隐藏的画布内存，现有断言直接检查用户可见的画面、重新盖章的墨迹和清除后的空白。测试中 pdf-lib 的流类型也按声明改为读出后校验。[4 倍基准对照](../../test-results/m20-evidence/worker-a/m20-preview-flatten-pairwise.log) · [隐藏画布首次测量](../../test-results/m20-evidence/qa-focused-final.log) · [类型复验](../../test-results/m20-evidence/qa-focus-types-final.log)
- 独立 CLI 样本中，PyMuPDF 1.26.7 的文本抽取在一组混合字段的打印页上以 `0xc0000005` 退出。用 M19 与 M20 的 v1 配置直接传入同样的已转换文本，生成的 PDF 字节完全相同，抽取都触发了同一错误。只改行距和内边距的对照可正常抽取。该组样本已分别核对原始 `/V`、标记文本、打印墨迹与安全角位。使用这个 PyMuPDF 版本从这组压平页抽取全文仍有已知限制。[阅读器对照](../../test-results/m20-evidence/lead-reader-compatibility/receipt.json) · [四组独立渲染](../../test-results/m20-evidence/lead-m20-pixels.json)
- Windows 沙箱的 tsx 获取用户信息时返回 `uv_os_get_passwd ENOMEM`。像素与 CLI 原日志均保留了启动退出码 1。在获准的本机环境以同一冻结 SHA 和 D 盘输入重跑，整个像素命令退出 0，CLI 成功与两种碰撞场景的退出码分别为 0、2、2。[首次像素日志](../../test-results/m20-evidence/qa-pixels.log) · [本机像素运行](../../test-results/m20-evidence/qa-pixels-native.json) · [首次 CLI 日志](../../test-results/m20-evidence/qa-cli-frozen-ready.log) · [本机 CLI](../../test-results/m20-evidence/cli-native-summary.json)

三条新增经验各有一次独立发生记录。Windows tsx 的既有经验累计 15 个周期，沿用已发布的恢复标准。[经验及证据](../../LESSONS.md) · [代码标准](../code-standards.md)
