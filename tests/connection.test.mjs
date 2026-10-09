import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServiceAddress, validateDemoService } from '../apps/client/src/lib/connection.js';

test('体验、下载和接口地址均可转换为同一个服务地址', () => {
  for (const input of [
    'http://192.168.92.39:8787',
    ' http://192.168.92.39:8787/ ',
    'http://192.168.92.39:8787/download/',
    'http://192.168.92.39:8787/api/',
  ]) {
    assert.equal(normalizeServiceAddress(input), 'http://192.168.92.39:8787/api');
  }
  assert.equal(
    normalizeServiceAddress('HTTPS://Example.COM:0443/download'),
    'https://example.com:443/api',
  );
  assert.equal(normalizeServiceAddress('/api'), '/api');
});

test('错误地址、凭证、查询参数及异常端口不能被当作服务连接', () => {
  for (const input of [
    '',
    'javascript:alert(1)',
    'https://user:password@example.com/api',
    'http://example.com/api?token=secret',
    'http://example.com/#/pages/home',
    'http://example.com/other',
    'http://example.com:0',
    'http://example.com:65536',
    'http://999.1.1.1',
    'http://127.1',
    'http://bad..name',
    'http://-bad.example',
  ]) {
    assert.throws(() => normalizeServiceAddress(input), Error, input);
  }
});

test('连接检查只接收健康的邻里集体验后端', () => {
  const health = { statusCode: 200, data: { ok: true, name: '邻里集', mode: 'demo' } };
  assert.equal(validateDemoService(health).mode, 'demo');
  assert.throws(
    () => validateDemoService({ ...health, data: { ...health.data, mode: 'production' } }),
    /不是体验服务/,
  );
  assert.throws(
    () => validateDemoService({ ...health, data: { ...health.data, mode: undefined } }),
    /不是体验服务/,
  );
  for (const value of [
    { statusCode: 503, data: health.data },
    { statusCode: 200, data: { ...health.data, ok: false } },
    { statusCode: 200, data: { ...health.data, name: 'other' } },
    { statusCode: 200, data: '<html>错误页面</html>' },
  ]) {
    assert.throws(() => validateDemoService(value), /没有提供可用/);
  }
});
