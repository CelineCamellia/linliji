# 部署与维护

本项目按单实例部署：一个 Node 服务、一份 SQLite 数据库、一个照片目录。适合从单个社区开始，根据实际访问量再扩容。仓库提供运行方式，不提供共享的公共服务器。

## HTTPS 与 Docker Compose

准备一台可运行 Docker Compose 的 Linux 服务器和解析到该服务器的域名，开放 80、443 端口。应用 API 不单独暴露端口。面向公众运营前应由运营者处理所在地和分发平台要求。

```sh
cp deploy/runtime.env.example deploy/runtime.env
# 编辑真实域名、运营者名称、邮箱与随机管理员密码
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

Caddy 自动申请 HTTPS 证书，并把网页、`/api/` 和 `/admin/` 转发到应用。默认注册策略为 `open`；使用 `invite` 时还要设置至少 16 位随机 `INVITE_CODE`。`closed` 关闭新账号注册。

`WX_APPID` 和 `WX_APP_SECRET` 同时留空时不提供微信登录，安卓和网页账号仍可正常使用。管理员密码至少 16 字符，推荐用密码管理器生成。改密后重启应用，之前的管理员会话会失效。

验证：打开域名，访问 `/api/health`，注册一个居民账号并发布，再从 `/admin/` 审核。手机安装 APK 后在首次连接页填写同一 HTTPS 域名。

持久化卷 `app_data` 保存数据库与照片，`app_backups` 保存快照。不要运行 `docker compose down -v` 来升级。单纯重建容器不会清空数据。

## 直接使用 Node

```sh
npm ci
npm run build
# runtime.env 放在仓库之外或已忽略的位置
node --env-file=deploy/runtime.env server/index.mjs
```

直接启动还应在环境文件中设置：

```dotenv
DB_PATH=./.local/production/linliji.sqlite
STATIC_DIR=./dist/web
HOST=127.0.0.1
PORT=8787
```

在前面配置 HTTPS 反向代理并用系统服务管理进程。仅当代理是唯一入口、应用端口不对外开放时设置 `TRUST_PROXY=1`。Compose 已按这个方式隔离端口。

`LOCAL_ONLY=1` 仅供本机快速启动，不能拿来绕过公网 HTTPS 配置。生产模式显式要求独立 `DB_PATH`，不能打开旧演示数据库。

## 配置表

| 配置                                | 说明                                  |
| ----------------------------------- | ------------------------------------- |
| `PUBLIC_ORIGIN`                     | 网站根地址，公网必须为真实 HTTPS 域名 |
| `OPERATOR_NAME` / `SUPPORT_EMAIL`   | 隐私页展示的运营者与联系邮箱          |
| `DEFAULT_CITY`                      | 初始城市，默认洛阳                    |
| `SUPPORTED_CITIES`                  | 逗号分隔的快捷城市，居民也能手动输入  |
| `REGISTRATION_MODE`                 | `open`、`invite` 或 `closed`          |
| `INVITE_CODE`                       | 邀请注册所用代码；不是社区成员验证    |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 管理账号，默认账号 admin              |
| `WX_APPID` / `WX_APP_SECRET`        | 可选微信服务端凭证；密钥仅放服务端    |
| `DB_PATH` / `STATIC_DIR`            | 数据库文件与编译后网页目录            |

每个部署的账号和内容完全独立。城市与社区名称是筛选条件，不构成私有群权限，也不会读取或同步微信群成员。

## 备份与恢复

Compose 每天生成一次备份，保留七天。手动触发：

```sh
docker compose -f deploy/compose.yaml exec app node scripts/backup.mjs
```

Node 方式先设置 `DB_PATH`、`BACKUP_DIR`，再运行 `node scripts/backup.mjs`。一个快照目录包含 `linliji.sqlite`、`uploads/` 与 `manifest.json`。脚本使用 SQLite 在线备份，校验数据库完整性，并复制快照中引用的照片；不能仅复制正在写入的 `.sqlite` 文件。

```sh
node scripts/restore.mjs /path/to/snapshot /path/to/new-data
```

恢复目标必须不存在，脚本会校验文件摘要并拒绝覆盖原目录。先停服务，保存当前数据，再把 `DB_PATH` 指向恢复目录。恢复后核对快照之后的注销和下架事项，避免已经删除的信息重新公开。容器卷的数据可先复制到隔离路径完成验证，再切换数据卷。

备份仍含个人信息，应限制访问，并同步七天保留周期到异地副本。未绑定照片和失去数据库记录的文件会在超过 24 小时后由应用定时清理。

## 升级与排查

升级前备份，保存当前 APK 签名和配置。更新代码后重新构建、运行测试，再重启应用。数据库创建采用兼容增加表和索引的方式；涉及破坏性结构变更时应另外提供迁移脚本。

- 照片上传失败：单张限制 5 MB，仅静态 JPG、PNG、WebP；代理请求限制需允许 multipart 开销，示例设为 6 MB。
- 安卓连接失败：先用手机浏览器检查 HTTPS 域名；自签名证书或纯 HTTP 地址不可用。
- 管理页登录后报来源错误：`PUBLIC_ORIGIN` 应与地址栏完全一致；代理保留原 Host，不能把内部地址写进浏览器。
- 数据为空：确认应用和管理页面使用同一服务，且 `DB_PATH` 指向正确数据库。
- 忘记居民密码：当前没有自助找回流程。运营者应先核实本人请求；不要把数据库或密码散列交给用户。
