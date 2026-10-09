import { isIP } from 'node:net';

export const POLICY_VERSION = '2026-10-06';
export function publicOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('PUBLIC_ORIGIN 必须填写真实 HTTPS 域名');
  }
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    isIP(url.hostname) ||
    !url.hostname.includes('.') ||
    /(^localhost$|\.(localhost|local|invalid|test|example)$|(^|\.)example\.(com|net|org)$)/i.test(
      url.hostname,
    )
  ) {
    throw Error('PUBLIC_ORIGIN 必须为真实 HTTPS 域名，不可使用 IP、测试域名或路径');
  }
  return url.origin;
}

const cityName = (value) =>
  typeof value === 'string' && /^[\p{L}\p{N} ·.-]{2,30}$/u.test(value.trim()) ? value.trim() : '';
export function loadConfig(env = process.env) {
  const mode = env.APP_MODE || 'demo';
  if (!['demo', 'production'].includes(mode)) throw Error('APP_MODE 只能为 demo 或 production');
  if (env.NODE_ENV === 'production' && mode !== 'production')
    throw Error('生产环境必须显式设置 APP_MODE=production');
  const defaultCity = cityName(env.DEFAULT_CITY || '洛阳');
  const cities = [
    ...new Set(
      (env.SUPPORTED_CITIES || '洛阳,北京,上海,广州,深圳,成都,杭州').split(',').map(cityName),
    ),
  ];
  if (!defaultCity || cities.some((city) => !city)) throw Error('请配置有效的城市名称');
  if (!cities.includes(defaultCity)) cities.unshift(defaultCity);
  const common = { mode, policyVersion: POLICY_VERSION, defaultCity, cities, siteName: '邻里集' };
  if (mode === 'demo')
    return {
      ...common,
      origins: (
        env.ALLOWED_ORIGINS ||
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8787,http://127.0.0.1:8787'
      ).split(','),
      operator: '本地开发环境',
      contact: '请联系服务运营者',
      registrationMode: 'closed',
      wechatEnabled: false,
    };
  const localOnly = env.LOCAL_ONLY === '1';
  let origin;
  if (localOnly) {
    const url = new URL(env.PUBLIC_ORIGIN || 'http://127.0.0.1:8788');
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw Error('本机运行只接受 http://127.0.0.1 或 localhost 地址');
    origin = url.origin;
  } else origin = publicOrigin(env.PUBLIC_ORIGIN);
  const wechatEnabled = !!(env.WX_APPID || env.WX_APP_SECRET);
  if (wechatEnabled && !/^wx[a-f0-9]{16}$/.test(env.WX_APPID || '')) throw Error('请配置 WX_APPID');
  if (wechatEnabled && !/^[a-f0-9]{32}$/i.test(env.WX_APP_SECRET || ''))
    throw Error('请在服务端配置 WX_APP_SECRET');
  if (!env.OPERATOR_NAME?.trim() || /待填|请填|示例|example|your[_-]/i.test(env.OPERATOR_NAME))
    throw Error('请填写真实 OPERATOR_NAME');
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_EMAIL || '') ||
    /example\.|your[_-]/i.test(env.SUPPORT_EMAIL)
  )
    throw Error('请填写真实 SUPPORT_EMAIL');
  const registrationMode = env.REGISTRATION_MODE || 'invite';
  if (!['open', 'invite', 'closed'].includes(registrationMode))
    throw Error('REGISTRATION_MODE 须为 open、invite 或 closed');
  if (
    registrationMode === 'invite' &&
    ((env.INVITE_CODE || '').length < 16 || /change|your_|example/i.test(env.INVITE_CODE))
  )
    throw Error('INVITE_CODE 至少 16 位，请使用随机值');
  const adminUsername = env.ADMIN_USERNAME || 'admin';
  const adminPassword = env.ADMIN_PASSWORD || '';
  if (
    adminPassword &&
    (adminPassword.length < 16 ||
      /请替换|change|your[_-]/i.test(adminPassword) ||
      !/^[a-zA-Z0-9_]{4,32}$/.test(adminUsername))
  )
    throw Error('管理员账号须为 4–32 位字母数字下划线，密码至少 16 位');
  return {
    ...common,
    localOnly,
    origin,
    origins: [origin, 'https://appassets.androidplatform.net'],
    appId: env.WX_APPID,
    appSecret: env.WX_APP_SECRET,
    wechatEnabled,
    operator: env.OPERATOR_NAME.trim(),
    contact: env.SUPPORT_EMAIL,
    registrationMode,
    inviteCode: env.INVITE_CODE || '',
    adminUsername,
    adminPassword,
    trustProxy: !localOnly && env.TRUST_PROXY === '1',
  };
}

export function siteSettings(config) {
  return {
    name: config.siteName || '邻里集',
    defaultCity: config.defaultCity || '洛阳',
    cities: config.cities || ['洛阳'],
    registration: config.registrationMode || 'invite',
    wechatLogin: config.wechatEnabled === true,
    photos: true,
  };
}

export function privacyPolicy(config) {
  return {
    version: POLICY_VERSION,
    operator: config.operator,
    contact: config.contact,
    sections: [
      {
        title: '服务范围',
        text: '邻里集提供居民手艺、闲置买卖与物品交换的信息发布和联系服务，不提供线上支付、配送或交易担保。请自行确认服务或交换条件。',
      },
      {
        title: '登录与必要信息',
        text: '公开浏览无需登录。微信登录只获取本小程序账号标识，不获取微信昵称、头像、手机号或通讯录；服务端保存账号标识的摘要。安卓和网页使用账号密码登录，密码经加盐计算后保存，不保存明文。是否需要邀请码由当前服务的运营者配置。',
      },
      {
        title: '发布与联系方式',
        text: '发布时收集文字描述、上传的照片、费用或交换条件、城市、社区和联系手机号。发布内容经人工审核后公开，手机号仅在你明确同意后向主动联系的已登录用户提供。请不要在公开描述中填写家庭住址、证件号或他人隐私。审核人员可查看发布资料以处理审核和举报。',
      },
      {
        title: '本机存储与权限',
        text: '本机存储登录凭证、城市选择和收藏。服务端保存账号、发布内容、举报与必要审核记录。无广告或第三方统计，不自动获取位置、相册、摄像头和通讯录；仅在你主动选择照片时读取所选文件，点击联系时打开拨号器。演示模式下填写的地址和订单只用于流程体验，请使用测试数据。',
      },
      {
        title: '保存、退出与注销',
        text: '可以在“我的”退出登录、下架发布或注销账号。注销会删除在线数据库中的账号、登录凭证、个人资料和发布内容；未完成的体验预约需先取消。隔离的灾备副本最多保留 7 天，到期删除；恢复备份前运营者应核对注销记录并重新完成删除。审核记录只保留不含账号标识和联系方式的事项编号与处理结果。',
      },
      {
        title: '联系与投诉',
        text: '如需访问、更正或删除信息，或投诉违规内容，请使用“举报信息”或联系本页运营者。未成年人请在监护人指导下使用，不应独立发布或进行线下交易。运营者应在 15 个工作日内回复个人信息请求。',
      },
    ],
  };
}
