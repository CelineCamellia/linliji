export function normalizeServiceAddress(value) {
  const input = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (input === '/api') return input;
  const match =
    /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?(?:\/(?:api|download))?$/i.exec(
      input,
    );
  if (!match) throw new Error('请填写网站根地址或以 /api 结尾的接口地址');
  const [, scheme, host, port] = match;
  if (
    host.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-')) ||
    (/^[0-9.]+$/.test(host) &&
      (host.split('.').length !== 4 || host.split('.').some((part) => Number(part) > 255))) ||
    (port && (Number(port) < 1 || Number(port) > 65535))
  ) {
    throw new Error('服务地址中的主机或端口不正确，请检查后重试');
  }
  return (
    scheme.toLowerCase() + '://' + host.toLowerCase() + (port ? ':' + Number(port) : '') + '/api'
  );
}

export function validateDemoService(response) {
  if (
    response.statusCode !== 200 ||
    response.data?.ok !== true ||
    response.data?.name !== '邻里集'
  ) {
    throw new Error('该地址没有提供可用的邻里集服务，请核对电脑显示的地址');
  }
  if (response.data.mode !== 'demo') {
    throw new Error('此地址不是体验服务，请使用电脑“启动手机体验”显示的地址');
  }
  return response.data;
}
