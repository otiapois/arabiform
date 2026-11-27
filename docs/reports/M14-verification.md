# ArabiForm v1.4.0 独立验收

M14 通过本机验收。真实 Edge 从可编辑 PDF 的 ZIP 拖入提取器，下载的 CSV、XLSX 与源 PDF 均保留阿文附标、前导零、复选框和选项值。原文件及两种表格的 SHA-256 全部吻合。116/116 个浏览器场景通过，完整保留此前的 110 个。固定种子接受 22,600 例，丢弃与失败均为 0。[正式浏览器收据](../../test-results/m14-evidence/qa-edge-summary.json) · [主线命令及退出码](../../test-results/m14-evidence/qa-formal.json)

## 验收版本

2026-11-27，独立 QA 在干净的主目录 `main`、提交 `b732ec9496b69d4ebc5f23be0291eb2a14996a82` 验证本地生产构建。Node 24.22.1、npm 11.11.0、Python 3.13.11、PyMuPDF 1.26.7，浏览器为 Microsoft Edge 124.0.2478.80。桌面窗口为 1440 × 900，移动端使用同一 Edge 的 390 × 844 触屏模拟。两种视口使用同一批测试。依赖、临时文件、运行缓存和验收收据均在 D 盘。[任务书](../tasks/M14-bulk-pdf-form-extractor.md) · [本次新增的 Edge 用例](../../tests/e2e/m14-extractor.spec.ts)

## 填表、提取和下载

在英文工作台上传两页 HR 模板与两行 UTF-8 名单，将 `ID` 映射到 PDF 文本字段 `Sentinel`。以可编辑模式下载 ZIP，拆开包内两份原始 PDF。直接从字段读取带附标的阿文姓名、`00123`、`00007`、复选框原生值 `Yes` / `Off`、诊所代码 `RIY` / `JED` 及单选值 `CALL` / `MAIL`。再把两份原字节与平面夹具同时拖入提取器，两行成功，一行显示平面 PDF 被拒绝。逐份用 Node 的 SHA-256 对照界面可展开的完整摘要和审计记录。[英文桌面截图](screenshots/m14/desktop-m14-extractor-en.png)

对实际下载的 CSV 读取 UTF-8 BOM，解析所有行列。直接解压 XLSX，解析工作表 XML，逐格断言 `inlineStr` 并比较原文。复选框的状态与原生值分别占列，诊所保留导出值和显示标签。平面样本命名为 `=flat.pdf`，CSV 为防止公式执行加上单引号，Excel 文本格和审计 JSON 保留源文件名。重新散列完整 CSV 和 XLSX，逐一匹配同次下载的 JSON。主执行端用 Python 和 PyMuPDF 独立读取两种视口的正式下载，复核两页重复的阿文文本控件、复选框原生状态以及单选项 `/0`、`/1` 与 `CALL`、`MAIL` 的对应关系。验证范围为文件字节、PDF 字段和显式单元格类型，未启动独立 Excel 客户端。[最终下载的双引擎复读](../../test-results/m14-evidence/lead-edge-extraction-readback.json)

阿语用户从 `/ar/` 收到 301 后进入 `/ar/pdf-mail-merge`。在英、阿两种工作台的默认填表模式下冷启动，只请求一个入口 JS。键盘进入提取模式时只新增本地提取面板和文件名显示组件，触发示例后才加载提取引擎及 PDF 依赖。三个示例 ID 为 `00123`、`00007` 和 `00891`。第三份 PDF 新增 `Notes`，界面列出字段差异，另外两份保持已提取状态。阿语文件名、字段值和完整摘要分别验证到行，表格可横向滚动，390 px 页面宽度保持不变。[阿语桌面截图](screenshots/m14/desktop-m14-extractor-ar.png) · [阿语手机截图](screenshots/m14/mobile-m14-extractor.png)

核心用例覆盖同批正常、平面、加密、XFA、已签名与损坏 PDF 的逐文件状态，同时检查 200 份上限内的输出和超限输入。开发阶段还在桌面 Edge 拖入 200 份平面 PDF，第二页从第 21 份开始。拖入 201 份时显示上限提示。[核心测试](../../tests/core/extractor.test.ts) · [前端边界测试记录](../../test-results/m14-evidence/web-smoke.md)

## 独立检查

| 检查 | 实测结果 |
|---|---|
| 类型、单元和夹具 | `typecheck` 通过，21 个测试文件共 138/138 项通过，24 个合成夹具通过字节校验。`fixtures/.gitattributes` 仍为原 blob `16687c743d52cd6832cb834023e0b8160b38bf1e`。[类型检查](../../test-results/m14-evidence/qa-typecheck.json) · [单元测试](../../test-results/m14-evidence/qa-unit.log) · [夹具](../../test-results/m14-evidence/qa-fixtures.log) |
| 固定种子 | `test:fuzz -- --reporter=default` 实测 39/39 组，种子 1243704626，共接受 22,600 例，丢弃 0，失败属性 0。新增的 2,500 例涵盖 1,300 例电子表格文本、700 例保存后的表单编码与复选框、500 例混合输入及字段差异。[计数日志](../../test-results/m14-evidence/qa-fuzz.log) |
| PDF 实绘 | 4 倍渲染 44 次填充和 140 个含墨迹控件，最小内距 6 px，裁切像素与允许区外变化均为 0。17 张合并页、8 张扁平 ZIP 页与参照一致。4 张 A4 拼版含 6 条记录、48 条裁线，框外墨迹为 0。[逐控件像素收据](../../test-results/m14-evidence/qa-pixels-verification.json) |
| 生产构建 | 默认域和本地严格域构建通过，向默认产物要求严格域时正确拒绝占位域名，随后已恢复默认产物。5 个规范 URL 与 5 个静态 HTML 共用入口 `index-DgpBEg-H.js`，原始 276,746 B、gzip 87,260 B，距上限分别为 3,254 B、240 B。核对两条阿语 301 规则、CSP 的 `connect-src 'none'`、站点地图、robots、许可和 CI。[产物与哈希](../../test-results/m14-evidence/qa-static.json) · [严格域通过](../../test-results/m14-evidence/qa-strict-release.log) · [占位域拒绝](../../test-results/m14-evidence/qa-default-reject.log) |
| Edge 回归 | 单执行者、零重试，116/116 通过，桌面和手机各 58 项。以测试文件、ID、标题和浏览器项目核对，保留 15 个原文件的全部 110 项。4,287 次本地请求中，外部 HTTP、WebSocket、HTTP 错误、控制台及运行时错误均为 0。4187、4194、43873 均拒绝新连接。[逐用例、网络与截图收据](../../test-results/m14-evidence/qa-edge-summary.json) · [原始运行日志](../../test-results/m14-evidence/qa-edge.log) |

在最终生产预览端口上分别读取 `/ar`、`/ar/`，两者均以 301 跳转至 `/ar/pdf-mail-merge`。目标页返回 200，HTML 声明 `lang="ar"`、`dir="rtl"` 和自身的规范 URL。[实际 HTTP 回执](../../test-results/m14-evidence/qa-alias.json)

## 实测发现与修复

提取结果面板和可滚动表格最初使用了同一个读屏区域名。英阿两个视口均出现 5 个区域、4 个不同名称。为表格滚动区补上独立的双语名称后，原检查通过。[首次失败](../../test-results/m14-evidence/qa-focused.log)

未选中模式按钮的透明边框与相邻底色仅 1∶1。两个模式按钮改用既有控件边框色后，保留原有检查重跑。四个提取示例页的全页测量中，普通文字最低 5.65∶1，控件标识最低 3.21∶1，焦点最低 5.88∶1。两项问题分别计入相应的开发周期。[第二次失败](../../test-results/m14-evidence/qa-focused-fixed.log) · [修复后双语测量](../../test-results/m14-evidence/qa-focused-final-summary.json) · [经验记录](../../LESSONS.md)

首轮全套 Edge 中，两个既有的 200 行进度及取消场景超时。新模式条占用了 `#workbench`，队列已经显示 200 行就绪，挂在工作台上的观察器却无法看见进度。修复后，工作台同时包含模式条、填表与提取内容。保持原 M2 用例不动，在两个视口复跑受影响的 4 项和 M14 的 6 项，10/10 通过，再开始最终主线整套验收。[首轮主线日志](../../test-results/m14-evidence/qa-edge-before-workbench.log) · [修复后 10 项收据](../../test-results/m14-evidence/qa-focused-anchor-summary.json)

首次 Windows 沙箱调用在 tsx 创建临时路径时返回 `uv_os_get_passwd ENOMEM`。按既有规则在获准环境中用相同主线、D 盘数据和临时目录重跑，PDF 生成及 PyMuPDF 像素比较均完成。此项为第九个独立周期，已有代码标准继续适用。[首次启动错误](../../test-results/m14-evidence/qa-pixels.log) · [同版本重跑](../../test-results/m14-evidence/qa-pixels-native.log) · [现行标准](../code-standards.md)
