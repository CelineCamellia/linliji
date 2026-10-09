const form = document.getElementById('login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('login-button'),
    error = document.getElementById('login-error');
  if (button.disabled) return;
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '登录失败');
    document.getElementById('password').value = '';
    window.location.assign('/admin/');
  } catch (cause) {
    error.textContent = cause.name === 'TypeError' ? '连接失败，请检查服务后重试' : cause.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
