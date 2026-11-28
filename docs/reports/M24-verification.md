# ArabiForm v2.4.0 本机独立验收

冻结主线 `deebdd6f24ff197b489f6c282058d67facabe6a3` 的 7 张合成 A6 访客证实际印在 2 张 A4 上。加一页双语封面后，估算和下载的 PDF 都是 3 页。再按名单中的 North、South 分开输出，每组有独立封面，两个 PDF 共 4 页。英阿双语的单页印前证书列出了源模板、名单和最终打印文件的完整 SHA-256。[实际证书](../../test-results/m24-evidence/qa-main/actual-edge-certificate.png) · [裁切堆叠的末张](../../test-results/m24-evidence/qa-main/actual-edge-final-stack.png)

类型检查通过，32 个文件中的 257 项单测全部通过。单独运行的 76 项性质测试使用固定种子 `1243704626`，共接受 48,096 例，丢弃和失败均为 0。M24 新增 1,000 例网格与裁切线、1,500 例分组页数及堆叠顺序、12 例真实证书摘要校验。大型测试的超时均至少 180,000 ms。四倍像素验收 87/87，真实 Edge 180/180。[冻结 SHA 与各命令退出码](../../test-results/m24-evidence/qa-main/formal-summary.json) · [固定种子原始结果](../../test-results/m24-evidence/qa-main/fuzz.log)

## 拼版、节纸与证书

| 核对项 | 实测结果 |
| --- | --- |
| 节纸分母 | 7 行无封面的 1-up 需 7 张，4-up 需 2 张，省 5 张（71.43%）。有封面时为 8 张变 3 张，省 62.5%。分组含两张封面时为 9 张变 4 张，省 55.56%。 |
| 四个位置的实际编号 | 顺序拼版的两张依次为 `1,2,3,4`、`5,6,7,空`。裁切堆叠依次为 `1,3,5,7`、`2,4,6,空`。裁开后按左上、右上、左下、右下的顺序收起四摞，就得到原名单顺序。空槽四倍渲染全白，封面索引逐行指向实际纸张。 |
| 页面方向与裁切 | 竖版 A6 输出竖向 A4。带偏移 CropBox、90° 旋转和间接 UserUnit 的 A6 输出横向 A4。每张成品卡四角各有两条独立裁切线，均落在卡片外侧。开启中心导线后每张纸多出两条辅助线。 |
| 下载顺序和改动后的身份 | 先下载证书再取打印件，以及先下载打印件再取证书，两种顺序均逐字节计算实际打印件 SHA-256。修改拼版、封面或改选第 2、7 行后，新证书引用新文件。选择两行时证书列出 2 行就绪、5 行排除。取消最后两行后，打印件和证书均禁用。 |
| 证书内容 | 重开下载的一页证书，检查双语标题、零裁切声明的字段预检范围、三个文件名和指纹、就绪及排除行数、拼版、纸张与封面数。逐一提取打印文件实际嵌入的字体，并从实绘的映射字形读取最小字号 14.54868984 pt，与证书按四位小数显示的 14.5487 pt 相符。 |
| 文件名与预设 | 用 `访客名单.csv` 上传相同真实字节，双语证书的 Subject 保留原始 Unicode 文件名。v12 预设导出后更改布局，再导入同一文件，堆叠顺序、中心导线、分组和双语封面均恢复。v1–v11 沿用既有独立往返、迁移、填表与下载回归。 |

上述页数从实际 Edge 下载计算，编号、几何、可见字体和文件指纹由独立读取程序检查。[Edge 场景](../../tests/e2e/m24-printshop.spec.ts) · [PyMuPDF 下载检查](../../tests/e2e/m24-print-proof.py) · [预设测试](../../tests/web/presets.test.ts)

## 四倍渲染与命令行

- PyMuPDF 1.26.7 以四倍渲染新旧 87 份样本，按名称比对保留原有 73 份。286 处控件中 260 处有墨迹，边缘裁切和允许区域以外的像素变化均为 0。M24 的两组 7 张 A6 卡共 4 张拼版，112 条裁切线、4 条中心导线，两份双语证书各一页。固定的四份外部 PDF 和 CFF 字体均重新核对 SHA-256。[原始像素结果](../../test-results/m24-evidence/qa-main/pixels-manifest-verification.json) · [逐项复核](../../test-results/m24-evidence/lead-pixel-recount.json) · [输入指纹](../../test-results/m24-evidence/lead-pinned-pixel-inputs.json)
- 通过真实 CLI 子进程读取旋转模板，传入 `--imposition 4-up --cover --print-certificate`。7 行就绪，0 行排除，实际打印件为 3 页。对打印件独立计算的 SHA-256 是 `cc450e1b7de53b50a0f7b796e7e1180ef05ef5ce9db2811f27e1899f885634da`，与单页证书和 custody 清单一致。带须打印的额外批注、全名单无法容纳两种输入均退出 2，均未生成打印件或证书。另用多页模板验证 CLI 明确拒绝不支持的拼版。[独立 CLI 命令与输出](../../test-results/m24-evidence/qa-main/cli-proof.json) · [多页模板及中文文件名](../../test-results/m24-evidence/lead-cli-rotated/receipt.json)

## Edge、静态发布与复跑

Microsoft Edge 124.0.2478.80 使用一个 Playwright worker 串行跑完桌面 1440 × 900 和手机 390 × 844，各 90 项。按项目、文件、测试 ID 和标题核对，M1–M23 原有 174 项全部保留，M24 新增 6 项，全程无跳过或重试。180 份浏览器监控共记录 11,004 次本地 HTTP 请求，外部请求、WebSocket、控制台及页面错误均为 0，结束后预览端口已关闭。[完整 Edge 原始报告](../../test-results/m24-evidence/qa-main/edge-results.json) · [运行监控和 M24 下载文件](../../test-results/m24-evidence/qa-main/runtime/) · [历史用例逐项比对](../../test-results/m24-evidence/lead-edge-recount.json)

首页和 `/ar/pdf-mail-merge` 在空闲时均只请求一个入口 JS，PDF、二维码、字体处理和拼版 JS 请求均为 0。加载 7 行名单后，两种视口的文档及 body 宽度均等于视口宽度。检查已启用的控件、可访问名称、实际文字和原生控件绘制，最低文字对比为 5.64∶1，边界为 3.20∶1，键盘焦点为 5.88∶1。[可访问性、空闲请求与视口实测](../../test-results/m24-evidence/qa-main/formal-summary.json)

基线中的 M23 阿语尺寸变化已正确隔离。冻结版本中，桌面负号和首个数字的横坐标分别为 1208.98、1213.52 px，手机为 262.83、267.36 px。新证书按钮的 `(.pdf)` 六个字符均在同一行从左向右排列。按实际字体测量收起状态的三条拼版选项，英阿页面的文本均放得下。[基线坐标](../../test-results/m24-evidence/lead-baseline-rtl-delta.json) · [英文桌面](screenshots/m24/desktop-m24-4up-estimator-en.png) · [阿语桌面](screenshots/m24/desktop-m24-4up-certificate-ar.png) · [阿语手机](screenshots/m24/mobile-m24-4up.png)

32 份合成夹具全部逐字节复现。默认域名、严格域名 `https://arabiform-qa.test` 和切回默认后的三次真实构建及发布校验都通过。五个静态路由最大入口 JS 为 271,301 字节，gzip 后为 84,336 字节，低于 274,000 / 85,800 字节限制。严格模式拒绝默认占位域名。发布检查覆盖 sitemap、隐私响应头、第三方许可和 CI 文件。夹具属性文件 Git 对象为 `16687c743d52cd6832cb834023e0b8160b38bf1e`。[夹具](../../test-results/m24-evidence/qa-main/fixtures.log) · [严格域名](../../test-results/m24-evidence/qa-main/verify-strict.log) · [占位域名拒绝](../../test-results/m24-evidence/qa-main/verify-strict-negative.log) · [恢复默认](../../test-results/m24-evidence/qa-main/verify-restored.log)

沙箱中的 tsx 启动时报 `uv_os_get_passwd ENOMEM`。使用相同冻结 SHA、输入及 D 盘临时位置，在普通 Windows 环境复跑 CLI 和像素命令。首次完整单测把正斜线临时路径的盘根判成了 `D:/`，转而访问无写权限的默认缓存。改用 Windows 反斜线路径后，原三项发布测试及完整单测均通过。[像素首次退出](../../test-results/m24-evidence/qa-main/pixels-sandbox.log) · [像素复跑](../../test-results/m24-evidence/qa-main/pixels.log) · [三项路径复验](../../test-results/m24-evidence/qa-main/unit-tmp-path-corrected.log) · [完整单测](../../test-results/m24-evidence/qa-main/unit.log)
