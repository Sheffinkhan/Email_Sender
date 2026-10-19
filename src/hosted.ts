import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { blobImageUploader, blobTemplateBackend, findBlobCredentials } from './blobStorage.js';
import { createLoginGate } from './login.js';
import { envSettingsStore } from './settings.js';
import { describeSentFolder } from './sentFolder.js';
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
 * SMTP_* for the mailbox, APP_PASSWORD for the login (falls back to the
 * mailbox password), and the Blob store connection (BLOB_READ_WRITE_TOKEN or
 * BLOB_STORE_ID, added when a store is connected) for saving.
 */
export function createHostedApp(env: Record<string, string | undefined>, root: string): express.Express {
  // Without a separate APP_PASSWORD, the mailbox password guards the app. Anyone
  // who knows it can already send from the mailbox, so nothing new is exposed.
  const password = env.APP_PASSWORD || env.SMTP_PASSWORD || '';
  if (!password) {
    return notReady(
      'Not set up yet: add SMTP_USER and SMTP_PASSWORD in the Vercel project under Settings, Environment Variables, then redeploy.',
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return notReady(
      env.APP_PASSWORD
        ? `APP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Change it in Vercel, then redeploy.`
        : `The mailbox password is shorter than ${MIN_PASSWORD_LENGTH} characters, too weak to guard a public website. Add APP_PASSWORD (${MIN_PASSWORD_LENGTH} or more characters) in Vercel, then redeploy.`,
    );
  }

  const bundled = fileBackend(path.join(root, 'templates'));
  const blob = findBlobCredentials(env);
  const settings = envSettingsStore(env);

  return createApp({
    transport: createSmtpTransport(settings.load),
    verify: verifyConnection,
    checkSent: describeSentFolder,
    templates: createTemplateStore(
      blob
        ? withSeed(blobTemplateBackend(blob), bundled)
        : readOnlyBackend(bundled, 'Saving online needs a Vercel Blob store connected to this project.'),
    ),
    settings,
    publicDir: path.join(root, 'public'),
    login: createLoginGate(password),
    uploadImage: blob ? blobImageUploader(blob) : undefined,
  });
}
