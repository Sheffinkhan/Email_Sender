import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { blobImageUploader, blobTemplateBackend } from './blobStorage.js';
import { createLoginGate } from './login.js';
import { envSettingsStore } from './settings.js';
import { createSmtpTransport, verifyConnection } from './smtp.js';
import { createTemplateStore, fileBackend, readOnlyBackend, withSeed } from './templateStore.js';

const MIN_PASSWORD_LENGTH = 12;

/** A stand-in that explains what is missing instead of serving an unprotected app. */
function notReady(message: string): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res) => {
    res.status(503).type('text/plain').send(message);
  });
  return app;
}

/**
 * The online (Vercel) version. Everything comes from environment variables:
 * APP_PASSWORD for the login, SMTP_* for the mailbox, and
 * BLOB_READ_WRITE_TOKEN (added when a Blob store is connected) for saving.
 */
export function createHostedApp(env: Record<string, string | undefined>, root: string): express.Express {
  const password = env.APP_PASSWORD ?? '';
  if (!password) {
    return notReady('Not set up yet: add APP_PASSWORD in the Vercel project under Settings, Environment Variables, then redeploy.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return notReady(`APP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Change it in Vercel, then redeploy.`);
  }

  const bundled = fileBackend(path.join(root, 'templates'));
  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  const settings = envSettingsStore(env);

  return createApp({
    transport: createSmtpTransport(settings.load),
    verify: verifyConnection,
    templates: createTemplateStore(
      blobToken
        ? withSeed(blobTemplateBackend(blobToken), bundled)
        : readOnlyBackend(bundled, 'Saving online needs a Vercel Blob store connected to this project.'),
    ),
    settings,
    publicDir: path.join(root, 'public'),
    login: createLoginGate(password),
    uploadImage: blobToken ? blobImageUploader(blobToken) : undefined,
  });
}
