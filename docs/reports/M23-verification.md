# ArabiForm v2.3.0 本机独立验收

冻结主线 `d97f92359fe2226ec3f4d413f02f04746b43dbf3` 通过独立验收。2027 版合成录用表将员工编号框收窄 22 pt，把字符上限从 40 降到 28，并移除了部门选项 `ARCHIVE`。比较页面检出三项变化。将姓名字段从 `FullName` 显式改配到 `EmployeeFullName` 后，旧 v11 预设能直接用于新版填表，29 位编号仍被预检拦截。

31 个单测文件中的 246 项全部通过。独立运行固定种子 `1243704626`，73 个性质检查共接受 45,584 例，丢弃和失败均为 0。大用例超时下限为 180,000 ms。完整 Edge 174/174，四倍 PDF 像素检查 73/73。实际结果取自同一冻结提交。[正式命令、退出码与汇总](../../test-results/m23-evidence/qa-main/formal-summary.json) · [固定种子原始输出](../../test-results/m23-evidence/qa-main/fuzz.log)

## 真实文件、报表与填表

| 核对项 | 实测结果 |
| --- | --- |
| 原始文件指纹 | 对两份上传文件独立计算 SHA-256。旧版为 `852d4ce5511b313417f81cad0bf4c6adc2b0c6b599a2643d70b3f93e3dd38474`，新版为 `2bca4e9955678e36b5faea34ef4a352da0342fae7c02d4f62d588446643764ad`。浏览器下载的 JSON 和 CSV 每行源指纹相符，报告保留 −22 pt、40→28、移除的导出值及显式重命名。 |
| 迁移范围 | 下载的 v11 与原预设逐项比较，姓名的映射、对齐、数字与留白设置、条件规则均换成新版字段名。虚拟列、文件命名规则和其余设置保留。未解决的姓名字段或仍引用已删除部门的条件规则会阻止迁移文件下载和填表交接。用加密 PDF 替换新版文件后，界面移除旧结果并给出错误。 |
| 名单与实际下载 | 从比较页面直接打开新版和预设，上传原始 CSV，首行在 PDF.js 画布上呈现。解包后重开两份 PDF，编号分别为 `00123`、`00007`，虚拟编号为 `HR-0001`、`HR-0002`。第一行阿语姓名按设置写成东阿拉伯数字 `١٢`，部门规则命中 `ENG`，普通行保留 `OPS`。两份均保留 Sentinel 原值 `KEEP 00109` 及其原外观流哈希。下载收据中的逐文件哈希与实际 PDF 字节相符。 |
| 超限行 | 把编号改为 29 个字符，正常预检显示 0 行就绪、1 行待修，ZIP 下载禁用，审计返回 `EmployeeCode / exceeds-maxlen`，超出 1 个字符。 |
| 命令行 | 通过 6 个真实 Node 子进程检查相同模板、破坏性结构变化、不兼容重命名、可迁移的变化、迁移后预检及严格填表，退出码依次为 0、2、2、2、0、0。不兼容目标没有生成迁移文件。结构变化已提示且字段引用已经修复时，CLI 同时写出迁移预设和两份审计报告。 |

四组浏览器下载均与独立 CLI 生成的两份 PDF、CSV 逐字节相同。JSON 报告和预设逐字段相同，CLI 文件末尾多一个换行，因此这两类文件在两端的字节哈希不同。[跨端比对记录](../../test-results/m23-evidence/qa-main/formal-summary.json)

浏览器操作与下载断言保存在 `tests/e2e/m23-template-diff.spec.ts`。同一次运行记录了预览墨迹、下载哈希和阿语扩展名字形的横坐标。[Edge 逐场景证据](../../test-results/m23-evidence/qa-main/qa-runtime/) · [独立 CLI 命令、源指纹和读回结果](../../test-results/m23-evidence/qa-main/cli-proof.json) · [额外的真实新增可选字段和 v1 检查](../../test-results/m23-evidence/lead-cli-independent/receipt.json)

## 浏览器与可访问性

Microsoft Edge 124.0.2478.80 串行通过 174/174 个场景，桌面 1440 × 900 和手机 390 × 844 各 87 个。按项目、测试 ID、标题及文件核对，M1–M22 的 166 项全部保留，M23 增加 8 项。全程 10,229 次本地 HTTP 请求，外部请求、WebSocket、控制台和页面错误均为 0，跳过和重试均为 0。[原始 Edge 报告](../../test-results/m23-evidence/qa-main/edge-results.json) · [基线与运行记录复核](../../test-results/m23-evidence/lead-edge-recount.json)

英、阿工作台空闲时只请求一个入口 JS。打开比较工具后加载比较面板，选齐两份 PDF 才加载差分引擎，示例数据在点击示例时加载。阿语界面通过 CSS 读取两份本地字体。已填充结果和交接后的工作台在 390 px 下均无横向溢出。实测正文、控制边界、焦点轮廓的最低对比分别为 5.64∶1、3.20∶1、5.88∶1。用键盘进入比较模式，操作后对阿语页面三个下载按钮逐字测量，`(.json)` 与 `(.csv)` 的字母、点和括号均在同一行从左向右排列。[延迟加载、对比度和截图哈希](../../test-results/m23-evidence/qa-main/edge-proof.json)

## PDF 像素与发布产物

- 冻结版的 pdf-lib 读回和 PyMuPDF 1.26.7 四倍渲染覆盖 M22 的 71 份样本和 M23 的 2 份新样本。258 条控件记录中有 232 处可见墨迹，边缘裁切和框外变化均为 0。两份迁移后录用表的 8 处控件都有墨迹，距控件边缘至少 10 个四倍渲染像素。沿用 M22 已核对的四份外部 PDF 和 CFF 字体。[像素原始报告](../../test-results/m23-evidence/qa-main/pixels-manifest-verification.json) · [跨版本逐份比对](../../test-results/m23-evidence/lead-pixel-recount.json) · [固定输入哈希](../../test-results/m23-evidence/lead-pinned-pixel-inputs.json)
- 29 份合成夹具逐字节复现。默认来源、严格来源 `https://arabiform-qa.test`、恢复默认来源后的三次构建及发布核验均通过。五个静态路由最大入口为 270,454 字节，gzip 84,167 字节，低于 274,000 / 85,800 字节上限。严格检查对默认 `.example` 返回 1。检查范围含 sitemap、隐私响应头、第三方许可声明和 CI。[夹具核对](../../test-results/m23-evidence/qa-main/fixtures.log) · [严格来源](../../test-results/m23-evidence/qa-main/verify-strict.log) · [占位域名拒绝](../../test-results/m23-evidence/qa-main/verify-strict-negative.log) · [恢复默认](../../test-results/m23-evidence/qa-main/verify-restored.log)

[英文桌面](screenshots/m23/desktop-m23-template-diff-en.png) · [阿语桌面](screenshots/m23/desktop-m23-template-diff-ar.png) · [390 px 阿语手机](screenshots/m23/mobile-m23-template-diff.png)

## 主线收尾

已关闭两处本机验收预览端口，移除 D 盘的四个临时工作树及其专用临时目录。Git 注销文档工作树后留下一层空目录，核对该路径为空且已注销后移除。仅剩干净的 `main` 工作树。夹具属性文件的 Git 对象仍为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[工作树清理记录](../../test-results/m23-evidence/lead-worktree-cleanup.json)
