import path from 'node:path';
import { createApp } from './app.js';
import { createGraphAuth } from './graph/auth.js';
import { createMsalClient } from './graph/msal.js';
import { createGraphTransport } from './graph/transport.js';
import { createSettingsStore } from './settings.js';
import { createTemplateStore } from './templateStore.js';

const port = Number(process.env.PORT ?? 3000);
const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, '.data');
const redirectUri = `http://localhost:${port}/auth/callback`;

const settings = createSettingsStore(path.join(dataDir, 'settings.json'));
const auth = createGraphAuth({
  loadSettings: settings.load,
  createClient: (current) => createMsalClient(current, path.join(dataDir, 'token-cache.json')),
  redirectUri,
});

const app = createApp({
  auth,
  transport: createGraphTransport(auth.getToken),
  templates: createTemplateStore(path.join(root, 'templates')),
  settings,
  publicDir: path.join(root, 'public'),
  redirectUri,
});

// Bound to this machine only. Nothing on the network can reach it.
app.listen(port, '127.0.0.1', () => {
  console.log(`Email Sender is running. Open http://localhost:${port}`);
});
