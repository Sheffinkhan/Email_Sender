import path from 'node:path';
import { createApp } from '../src/app.js';
import { createSettingsStore } from '../src/settings.js';
import {
  createSmtpTransport,
  verifyConnection,
} from '../src/smtp.js';
import { createTemplateStore } from '../src/templateStore.js';

const root = process.cwd();

const settings = createSettingsStore(
  path.join(root, '.data', 'settings.json')
);

const app = createApp({
  transport: createSmtpTransport(settings.load),
  verify: verifyConnection,
  templates: createTemplateStore(path.join(root, 'templates')),
  settings,
  publicDir: path.join(root, 'public'),
});

export default app;