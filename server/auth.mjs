import { randomUUID, randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { privacyPolicy } from './runtime.mjs';

const derive = promisify(scrypt);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const equal = (a, b) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

export async function exchangeWechat(code, config) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({
    appid: config.appId,
    secret: config.appSecret,
    js_code: code,
    grant_type: 'authorization_code',
  });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) fail(502, '微信登录服务暂时不可用');
    const result = await response.json();
    if (result.errcode || typeof result.openid !== 'string' || !result.openid)
      fail(401, '微信登录凭证无效，请重新登录');
    return result.openid;
  } catch (e) {
    // Never log the upstream URL, AppSecret, openid or session_key.
    if (e.status) throw e;
    fail(502, '微信登录服务暂时不可用，请稍后重试');
  }
}

export function createAuth({ db, config, body, rate, exchange = exchangeWechat }) {
  const row = (sql, ...args) => db.prepare(sql).get(...args);
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  function consent(data) {
    if (data.consentVersion !== config.policyVersion) fail(400, '请阅读并同意当前版本的隐私说明');
  }
  function grant(id, data) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      digest(token),
      id,
      Date.now() + 7 * 86400000,
    );
    db.prepare(
      'INSERT INTO consents VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,accepted=excluded.accepted',
    ).run(id, data.consentVersion, new Date().toISOString());
    const u = row('SELECT id,nickname FROM users WHERE id=?', id);
    return { token, user: u, mode: config.mode };
  }
  let activePasswordJobs = 0;
  return async function handle({ path, method, req, send, ip }) {
    if (path === '/api/policy' && method === 'GET') {
      send(200, privacyPolicy(config));
      return true;
    }
    if (
      !['/api/auth/wechat', '/api/auth/password', '/api/auth/register'].includes(path) ||
      method !== 'POST'
    )
      return false;
    if (config.mode !== 'production') fail(404, '当前为体验环境，请使用体验账号');
    rate('auth-ip:' + ip, 20);
    const data = await body(req);
    consent(data);
    if (path === '/api/auth/wechat') {
      if (config.wechatEnabled === false) fail(403, '此服务暂未开放微信登录');
      if (typeof data.code !== 'string' || !data.code.length || data.code.length > 256)
        fail(400, '微信登录凭证格式错误');
      const openid = await exchange(data.code, config);
      if (typeof openid !== 'string' || !openid) fail(502, '微信登录服务返回异常');
      const subject = digest(config.appId + ':' + openid);
      const result = transaction(() => {
        let identity = row(
          'SELECT user_id FROM identities WHERE provider=? AND subject=?',
          'wechat',
          subject,
        );
        if (!identity) {
          if (config.registrationMode === 'closed') fail(403, '此服务暂未开放注册');
          if (
            config.registrationMode !== 'open' &&
            (typeof data.inviteCode !== 'string' || !equal(data.inviteCode, config.inviteCode))
          )
            fail(403, '邀请码不正确，请联系运营者');
          const id = randomUUID();
          db.prepare('INSERT INTO users VALUES(?,?,?)').run(
            id,
            '邻里用户',
            new Date().toISOString(),
          );
          db.prepare('INSERT INTO identities VALUES(?,?,?)').run('wechat', subject, id);
          identity = { user_id: id };
        }
        return grant(identity.user_id, data);
      });
      send(200, result);
      return true;
    }
    const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    if (
      !/^[a-z0-9_]{4,32}$/.test(username) ||
      typeof data.password !== 'string' ||
      data.password.length < 12 ||
      data.password.length > 128
    )
      fail(400, '账号为 4–32 位字母数字或下划线，密码为 12–128 位');
    rate('auth-account:' + digest(username), 10);
    if (activePasswordJobs >= 4) fail(429, '登录繁忙，请稍后再试');
    if (path.endsWith('/register')) {
      if (config.registrationMode === 'closed') fail(403, '此服务暂未开放注册');
      if (
        config.registrationMode !== 'open' &&
        (typeof data.inviteCode !== 'string' || !equal(data.inviteCode, config.inviteCode))
      )
        fail(403, '邀请码不正确，请联系运营者');
    }
    activePasswordJobs++;
    try {
      const existing = row('SELECT * FROM credentials WHERE username=?', username);
      const salt = existing?.salt || randomBytes(16).toString('hex');
      const passwordHash = (await derive(data.password, salt, 64)).toString('hex');
      if (path.endsWith('/password')) {
        if (!existing || !equal(passwordHash, existing.password_hash))
          fail(401, '账号或密码不正确');
        // An account may be deleted while scrypt is awaiting its worker.
        if (!row('SELECT id FROM users WHERE id=?', existing.user_id))
          fail(401, '账号或密码不正确');
        send(
          200,
          transaction(() => grant(existing.user_id, data)),
        );
        return true;
      }
      if (row('SELECT username FROM credentials WHERE username=?', username))
        fail(409, '该账号已注册');
      const result = transaction(() => {
        const id = randomUUID();
        db.prepare('INSERT INTO users VALUES(?,?,?)').run(id, '邻里用户', new Date().toISOString());
        db.prepare('INSERT INTO credentials VALUES(?,?,?,?)').run(username, id, salt, passwordHash);
        return grant(id, data);
      });
      send(201, result);
      return true;
    } finally {
      activePasswordJobs--;
    }
  };
}
