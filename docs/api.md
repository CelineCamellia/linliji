# API 简表

基址为 `/api`，JSON 错误包含 `message`。居民受保护接口使用 `Authorization: Bearer <token>`。管理员使用独立 Cookie。请求内容限制 32 KB，上传使用单独限制。

| 方法                 | 路径                             | 说明                                                   |
| -------------------- | -------------------------------- | ------------------------------------------------------ |
| GET                  | `/health`、`/site`、`/policy`    | 健康、站点设置和隐私说明                               |
| POST                 | `/auth/register`                 | 账号、密码、consentVersion；按策略填写 inviteCode      |
| POST                 | `/auth/password`                 | 账号密码登录                                           |
| POST                 | `/auth/wechat`                   | 微信 code、consentVersion；新账号按策略提供 inviteCode |
| POST                 | `/auth/logout`                   | 撤销当前居民会话                                       |
| GET / DELETE         | `/me`                            | 当前账号；注销体为 `{"confirm":"DELETE"}`              |
| GET                  | `/public/listings`               | 公开内容，支持 city、community、kind、q、sort、page    |
| GET                  | `/public/listings/:id`           | 已审核详情，无电话                                     |
| GET                  | `/public/communities?city=洛阳`  | 从公开内容提取社区名称                                 |
| GET                  | `/listings?mine=1&page=1`        | 本人发布及审核结果                                     |
| POST                 | `/listings`                      | 新建发布，生产模式进入 pending                         |
| GET / PATCH / DELETE | `/listings/:id`                  | 详情、本人修改并重审、本人下架                         |
| GET                  | `/listings/:id/contact`          | 已登录用户查看公开发布的联系电话                       |
| POST                 | `/uploads`                       | multipart 字段 photo，一张图片，返回 id 和短期预览地址 |
| GET                  | `/media/:id`                     | 公开照片或有签名的本人预览                             |
| POST                 | `/reports`                       | listingId、reason                                      |
| POST                 | `/admin/session`                 | 管理员账号密码登录                                     |
| GET                  | `/admin/listings?status=pending` | 管理审核列表                                           |
| POST                 | `/admin/listings/:id/review`     | decision、expectedStatus、reason                       |
| GET                  | `/admin/reports?status=open`     | 待处理举报                                             |
| POST                 | `/admin/reports/:id/close`       | reason、confirm=true                                   |
| POST                 | `/admin/session/logout`          | 管理员退出                                             |

发布示例：

```json
{
  "kind": "exchange",
  "priceMode": "exchange",
  "price": 0,
  "title": "几本读完的儿童绘本",
  "description": "书页完整，封面有使用痕迹，可以在社区门口当面交换。",
  "exchangeFor": "想换适合小学生的科普书",
  "art": "book",
  "condition": "九成新",
  "city": "洛阳",
  "area": "洛龙区",
  "community": "石油社区",
  "phone": "13800000000",
  "phoneSharingConsent": true,
  "photos": []
}
```

示例电话仅用于说明格式，请勿用于真实发布。photos 填写本人上传得到的 id，最多四个。请求中的 owned、nickname、status 不会覆盖服务端身份或审核状态。

带 page 的列表返回 `{items,total,page,pageSize}`，pageSize 为 20。无 page 的数组返回保留用于旧客户端兼容。
