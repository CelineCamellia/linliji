# 安卓构建与使用

安卓程序是原生 Java WebView 容器，内置 uni-app 编译的网页，通过 HTTPS 连接所选服务。最低 Android 6.0，目标 API 35；没有定位、广泛存储、通讯录或相机权限。

## 安装现成 APK

从 GitHub Release 下载 `linliji-0.3.0.apk`，按系统提示允许此次安装。打开后点击“设置服务地址”，填写运营者部署的 HTTPS 域名，检查成功后回到首页。

安装包没有公共服务账号或固定演示服务器。填写地址后才能读取该服务的内容，注册的账号也只属于该服务。如果尚无服务器，先按本机启动文档在电脑浏览器使用完整流程。

系统选择器只在主动添加照片时打开，读取用户选择的图片；点击联系方式打开拨号器，不直接拨出电话。

## 从源码构建

需要 Python 3.10+、JDK 17、Android SDK Platform 35 与 Build Tools 35.0.0。使用你已经安装的 SDK，脚本不会下载工具。

```sh
npm ci
npm run build:android-web
# 设置 JAVA_HOME、ANDROID_HOME
# 设置 ANDROID_KEYSTORE、ANDROID_KEY_ALIAS、ANDROID_KEYSTORE_PASSWORD
python scripts/build-android-release.py
```

Windows PowerShell 的环境变量写法为 `$env:ANDROID_HOME='E:\AndroidSdk'`；Linux/macOS 使用 `export ANDROID_HOME=/path/to/sdk`。密码建议在当前终端会话或受保护的 CI Secret 中注入，不写入脚本、命令日志或仓库。

第一次独立发布需要自己的证书，例如：

```sh
keytool -genkeypair -keystore /secure/location/release.keystore -alias linliji -keyalg RSA -keysize 3072 -validity 10000
```

该命令会交互式询问密码。请备份证书及密码，后续版本必须使用同一签名才能直接更新。构建脚本遇到签名缺失会停止，不会自动创建替代证书。

产物在 `dist/linliji-0.3.0.apk`，构建信息和 SHA256 在 `dist/android-build.json`。脚本执行 aapt2、javac、D8、zipalign 和 apksigner，不依赖 Android Studio 窗口或云端打包。

修改应用包名用于独立发行时，需同步 Manifest、Java 包与目录路径。版本号来自根 package.json，Android versionCode 位于 Manifest，升级时应递增。

## 微信构建

```sh
# 设置你自己的 WX_APPID 与 PUBLIC_ORIGIN
npm run build:wechat
```

将 `dist/mp-weixin` 导入微信开发者工具，配置 HTTPS 请求与上传域名。AppSecret 只放服务端，不能放前端构建环境或 GitHub。编译成功不替代微信备案、类目、隐私声明、审核及分享权限要求。
