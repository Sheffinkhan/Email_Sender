import path from 'node:path';
import { createApp } from './app.js';
import { createSettingsStore } from './settings.js';
import { createSmtpTransport, verifyConnection } from './smtp.js';
import { createTemplateStore, fileBackend } from './templateStore.js';

const port = Number(process.env.PORT ?? 3000);
const root = path.resolve(import.meta.dirname, '..');
const settings = createSettingsStore(path.join(root, '.data', 'settings.json'));

const app = createApp({
  transport: createSmtpTransport(settings.load),
  verify: verifyConnection,
  templates: createTemplateStore(fileBackend(path.join(root, 'templates'))),
  settings,
  publicDir: path.join(root, 'public'),
});

// Bound to this machine only. Nothing on the network can reach it.
app.listen(port, '127.0.0.1', () => {
  console.log(`Email Sender is running. Open http://localhost:${port}`);
});
