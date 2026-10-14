const SECTION_LABELS = {
  logo: 'Logo / company name',
  banner: 'Banner image',
  heading: 'Greeting',
  intro: 'Opening text',
  media: 'GIF / video',
  button: 'Button',
  details: 'Main text',
  panel: 'Coloured box',
  footer: 'Footer',
};
const BLANK = {
  order: Object.keys(SECTION_LABELS),
  id: '', name: 'New template', brandName: '', logoUrl: '', bannerUrl: '', accentColor: '#2563eb',
  heading: '', intro: '', mediaUrl: '', videoUrl: '', videoLabel: '', buttonLabel: '', buttonUrl: '',
  details: '', panelTitle: '', panelText: '', footer: '',
};

const $ = (id) => document.getElementById(id);
const fieldInputs = [...document.querySelectorAll('[data-field]')];
const orderList = $('order');

let template = { ...BLANK };
let sendingFrom = null;
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
  orderList.replaceChildren(
    ...template.order.map((id) => {
      const item = document.createElement('li');
      item.dataset.section = id;
      item.tabIndex = 0;
      item.textContent = SECTION_LABELS[id];
      return item;
    }),
  );
  arrangeFields();
}

// The field groups follow the email's order so the form reads like the email.
function arrangeFields() {
  for (const id of template.order) {
    $('fieldGroups').append(document.querySelector(`[data-section-fields="${id}"]`));
  }
}

function commitOrder() {
  template.order = [...orderList.children].map((item) => item.dataset.section);
  arrangeFields();
  schedulePreview();
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
  sendingFrom = status.account;
  $('setup').hidden = status.configured;
  $('showSetup').hidden = !status.configured;
  $('disconnect').hidden = !status.configured;
  $('accountLabel').textContent = status.configured
    ? `From: ${status.fromName ? `${status.fromName} <${status.account}>` : status.account}`
    : 'Email not connected';

  $('smtpUser').value = status.account ?? '';
  $('fromName').value = status.fromName ?? '';
  $('smtpPassword').value = '';
  $('smtpPassword').placeholder = status.configured ? 'Leave empty to keep the saved password' : '';
  $('smtpPort').value = String(status.port ?? 465);
  setHost(status.host ?? $('provider').options[0].value);
}

// Keeps the provider list and the server box in step with each other.
function setHost(host) {
  const known = [...$('provider').options].some((option) => option.value === host);
  $('provider').value = known ? host : '';
  $('smtpHost').value = host;
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

  if (!sendingFrom) {
    status.textContent = 'Connect your email account first.';
    return;
  }
  if (!confirm(`Send this email from ${sendingFrom} to ${count} recipient(s)?`)) return;

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
  const maxMb = Number(box.dataset.maxMb ?? 1);
  const file = box.querySelector('input[type="file"]');

  file.addEventListener('change', () => {
    const [chosen] = file.files;
    file.value = '';
    if (!chosen) return;
    if (chosen.size > maxMb * 1_000_000) {
      showNotice(`That file is over ${maxMb} MB. Use a smaller one, or host it online and paste its link.`);
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

let dragged = null;

// Pointer events cover mouse, pen and touch. The list holds the capture, not
// the row, because moving a row in the page would release it.
orderList.addEventListener('pointerdown', (event) => {
  const item = event.target.closest('li');
  if (!item || event.button !== 0) return;
  dragged = item;
  dragged.classList.add('dragging');
  orderList.setPointerCapture(event.pointerId);
});

// The dragged row moves live to wherever it would land.
orderList.addEventListener('pointermove', (event) => {
  if (!dragged) return;
  const next = [...orderList.children].find((item) => {
    const box = item.getBoundingClientRect();
    return item !== dragged && event.clientY < box.top + box.height / 2;
  });
  if ((next ?? null) !== dragged.nextElementSibling) orderList.insertBefore(dragged, next ?? null);
});

function endDrag() {
  if (!dragged) return;
  dragged.classList.remove('dragging');
  dragged = null;
  commitOrder();
}

orderList.addEventListener('pointerup', endDrag);
orderList.addEventListener('pointercancel', endDrag);

// Arrow keys do the same for anyone not using a mouse.
orderList.addEventListener('keydown', (event) => {
  const item = event.target.closest('li');
  if (event.key === 'ArrowUp' && item.previousElementSibling) {
    orderList.insertBefore(item, item.previousElementSibling);
  } else if (event.key === 'ArrowDown' && item.nextElementSibling) {
    orderList.insertBefore(item.nextElementSibling, item);
  } else {
    return;
  }
  event.preventDefault();
  item.focus();
  commitOrder();
});

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

$('provider').addEventListener('change', (event) => {
  if (event.target.value) setHost(event.target.value);
  else $('smtpHost').focus();
});

$('smtpHost').addEventListener('input', (event) => setHost(event.target.value.trim()));

$('setupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('setupStatus');
  $('saveSetup').disabled = true;
  status.textContent = 'Testing the login…';
  try {
    await api('PUT', '/api/settings', {
      user: $('smtpUser').value,
      password: $('smtpPassword').value,
      fromName: $('fromName').value,
      host: $('smtpHost').value,
      port: Number($('smtpPort').value),
    });
    await loadStatus();
    status.textContent = 'Connected.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    $('saveSetup').disabled = false;
  }
});

$('disconnect').addEventListener('click', async () => {
  if (!confirm(`Disconnect ${sendingFrom}? The saved password is removed from this PC.`)) return;
  await api('DELETE', '/api/settings');
  await loadStatus();
  $('setupStatus').textContent = 'Disconnected.';
});

await Promise.all([loadStatus(), loadTemplates()]);
