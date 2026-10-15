const form = document.getElementById('loginForm');
const status = document.getElementById('loginStatus');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  status.textContent = 'Checking…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    if (response.ok) {
      location.href = '/';
      return;
    }
    const data = await response.json().catch(() => ({}));
    status.textContent = data.error || `Could not log in (${response.status})`;
  } catch {
    status.textContent = 'Could not reach the server. Try again.';
  } finally {
    submit.disabled = false;
  }
});
