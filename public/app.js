const MAX_IMAGE_BYTES = 1_000_000;
const BLANK = {
  id: '', name: 'New template', brandName: '', logoUrl: '', bannerUrl: '', accentColor: '#2563eb',
  heading: '', intro: '', buttonLabel: '', buttonUrl: '', details: '', panelTitle: '', panelText: '', footer: '',
};

const $ = (id) => document.getElementById(id);
const fieldInputs = [...document.querySelectorAll('[data-field]')];

let template = { ...BLANK };
let signedInAs = null;
let previewTimer;

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showNotice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

const isUpload = (value) => value.startsWith('data:');

// Uploaded images live in `template` only. Their data is far too long to show in a text box.
function fillForm() {
  for (const input of fieldInputs) {
    const value = template[input.dataset.field];
    if (input.type === 'url' && isUpload(value)) {
      input.value = '';
      input.placeholder = 'Uploaded image in use';
    } else {
      input.value = value;
      if (input.closest('.image-field')) input.placeholder = 'https://… or upload';
    }
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 250);
}

async function renderPreview() {
  try {
    const { html } = await api('POST', '/api/preview', { template, recipients: $('to').value });
    $('preview').srcdoc = html;
    showNotice('');
  } catch (error) {
    showNotice(error.message);
  }
}

async function loadStatus() {
  const status = await api('GET', '/api/status');
  signedInAs = status.account;
  $('redirectUri').textContent = status.redirectUri;
  $('setup').hidden = status.configured;
  $('showSetup').hidden = !status.configured;
  $('signIn').hidden = !status.configured || Boolean(status.account);
  $('signOut').hidden = !status.account;
  $('accountLabel').textContent = status.account
    ? `From: ${status.account}`
    : status.configured ? 'Not signed in' : 'Outlook not connected';
}

async function loadTemplates(selectId) {
  const list = await api('GET', '/api/templates');
  const picker = $('templatePicker');
  picker.replaceChildren(
    ...list.map(({ id, name }) => new Option(name, id)),
    new Option('+ New blank template', ''),
  );
  const id = selectId ?? list[0]?.id ?? '';
  picker.value = id;
  template = id ? await api('GET', `/api/templates/${id}`) : { ...BLANK };
  fillForm();
  await renderPreview();
}

async function saveTemplate(asNew) {
  const status = $('saveStatus');
  try {
    const saved = await api('POST', '/api/templates', { ...template, id: asNew ? '' : template.id });
    await loadTemplates(saved.id);
    status.textContent = `Saved "${saved.name}"`;
  } catch (error) {
    status.textContent = error.message;
  }
}

async function send(event) {
  event.preventDefault();
  const to = $('to').value;
  const count = to.split(/[\n,;]+/).filter((entry) => entry.trim()).length;
  const status = $('sendStatus');
  $('results').replaceChildren();

  if (!signedInAs) {
    status.textContent = 'Sign in to Outlook first.';
    return;
  }
  if (!confirm(`Send this email from ${signedInAs} to ${count} recipient(s)?`)) return;

  $('send').disabled = true;
  status.textContent = 'Sending…';
  try {
    const { results } = await api('POST', '/api/send', { template, subject: $('subject').value, recipients: to });
    const sent = results.filter((result) => result.ok).length;
    status.textContent = `${sent} of ${results.length} sent`;
    $('results').replaceChildren(
      ...results.map((result) => {
        const item = document.createElement('li');
        item.className = result.ok ? 'ok' : 'failed';
        item.textContent = result.ok ? `✓ ${result.email}` : `✗ ${result.email}: ${result.error}`;
        return item;
      }),
    );
  } catch (error) {
    status.textContent = error.message;
  } finally {
    $('send').disabled = false;
  }
}

for (const input of fieldInputs) {
  input.addEventListener('input', () => {
    template[input.dataset.field] = input.value;
    schedulePreview();
  });
}

for (const box of document.querySelectorAll('.image-field')) {
  const field = box.dataset.image;
  const file = box.querySelector('input[type="file"]');

  file.addEventListener('change', () => {
    const [chosen] = file.files;
    file.value = '';
    if (!chosen) return;
    if (chosen.size > MAX_IMAGE_BYTES) {
      showNotice('That image is over 1 MB. Use a smaller one.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      template[field] = reader.result;
      fillForm();
      renderPreview();
    };
    reader.readAsDataURL(chosen);
  });

  box.querySelector('[data-clear]').addEventListener('click', () => {
    template[field] = '';
    fillForm();
    renderPreview();
  });
}

$('to').addEventListener('input', schedulePreview);
$('editor').addEventListener('submit', send);
$('save').addEventListener('click', () => saveTemplate(false));
$('saveAs').addEventListener('click', () => saveTemplate(true));
$('templatePicker').addEventListener('change', (event) => loadTemplates(event.target.value));

$('remove').addEventListener('click', async () => {
  if (!template.id || !confirm(`Delete the template "${template.name}"?`)) return;
  await api('DELETE', `/api/templates/${template.id}`);
  await loadTemplates();
  $('saveStatus').textContent = 'Deleted';
});

$('showSetup').addEventListener('click', () => {
  $('setup').hidden = !$('setup').hidden;
});

$('setupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('PUT', '/api/settings', { clientId: $('clientId').value, tenant: $('tenant').value });
    showNotice('');
    await loadStatus();
  } catch (error) {
    showNotice(error.message);
  }
});

$('signOut').addEventListener('click', async () => {
  await api('POST', '/auth/logout');
  await loadStatus();
});

const authError = new URLSearchParams(location.search).get('auth_error');
history.replaceState(null, '', location.pathname);

await Promise.all([loadStatus(), loadTemplates()]);
if (authError) showNotice(`Outlook sign-in failed: ${authError}`);
