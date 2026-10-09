# 验证方式

```sh
npm ci
npm test
npm run build
```

`npm test` 使用 Node test runner 和临时 SQLite 数据库，覆盖身份、权限、发布类型、社区筛选、审核状态、举报、注销、照片及备份恢复。临时数据写入项目的 `.cache/tests`，不使用已有运营库。

浏览器检查使用 Playwright。安装浏览器到项目目录：

```sh
# Linux/macOS
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium
# PowerShell
$env:PLAYWRIGHT_BROWSERS_PATH='.cache/playwright'
npx playwright install chromium
```

```sh
npm run test:platform-ui
npm run test:neighborhood-ui
```

前者覆盖同源管理员登录、开放注册、选图上传、照片审核、多城市隔离、编辑重审和退出管理。后者覆盖三种发布类型、注册联系、断网保留输入、分页、举报下架与注销。截图和结果保存到 `artifacts/`，使用隔离测试资料。

安卓内置网页检查：`npm run build:android-web` 后运行 `npm run test:android-ui`。它通过浏览器模拟 WebView 资源地址，验证首次连接、错误服务不会覆盖原地址，以及不同服务的账号隔离；不等于安卓真机安装测试。

微信编译检查：用 `WX_APPID=wx0000000000000000` 和 `PUBLIC_ORIGIN=https://pilot.linliji.cn` 构建测试产物，再执行 `node tests/release-wechat.mjs`。测试域名只用于断言构建配置，传输重定向到隔离服务；不提交该产物给实际用户。模拟的 wx.login 只能检查编译代码与后端契约。

## 0.3.0 的验证边界

已执行的结果记录在交付检查中，不把“写了测试”当成“跑过测试”。浏览器检查不能证明手机拨号器、系统相册或所有 WebView 版本均可用。安卓包还需安装到实际设备检查照片选择、系统返回键、拨号和覆盖升级。

本地环境的 Docker 引擎未启动，Compose 可以做配置解析检查，但容器运行、证书申请和公网可达性需要在部署环境验证。没有大规模压力测试结论。

本次已执行的检查见 [0.3.0 验证记录](verification.md)。
