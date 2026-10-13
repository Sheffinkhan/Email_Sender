import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { NotConfiguredError, NotSignedInError, type GraphAuth } from './graph/auth.js';
import type { MailTransport } from './graph/transport.js';
import { sendToAll } from './mailer.js';
import { parseRecipients, type Recipient } from './recipients.js';
import { renderEmail } from './render.js';
import { SettingsError, type SettingsStore } from './settings.js';
import { normaliseTemplate, TemplateError, type TemplateStore } from './templateStore.js';

export interface AppDeps {
  auth: GraphAuth;
  transport: MailTransport;
  templates: TemplateStore;
  settings: SettingsStore;
  publicDir: string;
  redirectUri: string;
}

class BadRequest extends Error {}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PREVIEW_RECIPIENT: Recipient = { email: 'client@example.com', name: 'Alex' };

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// The app controls a mailbox, so only pages served by this app on this machine may call it.
const localOnly: RequestHandler = (req, res, next) => {
  const { host, origin } = req.headers;
  if (!host || !isLocal(`http://${host}`) || (origin !== undefined && !isLocal(origin))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const type = (error as { type?: string }).type;
  if (error instanceof BadRequest || error instanceof TemplateError || error instanceof SettingsError) {
    res.status(400).json({ error: error.message });
  } else if (error instanceof NotSignedInError) {
    res.status(401).json({ error: error.message });
  } else if (error instanceof NotConfiguredError) {
    res.status(409).json({ error: error.message });
  } else if (type === 'entity.too.large') {
    res.status(413).json({ error: 'That is too large. Use smaller images.' });
  } else if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid request' });
  } else {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new BadRequest(`${field} is required`);
  return value;
}

export function createApp(deps: AppDeps): express.Express {
  const { auth, transport, templates, settings, publicDir, redirectUri } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly);
  app.use(express.json({ limit: '6mb' }));
  app.use(express.static(publicDir));

  app.get('/api/status', async (_req, res) => {
    res.json({ ...(await auth.status()), redirectUri });
  });

  app.put('/api/settings', async (req, res) => {
    // Tokens belong to the previous app registration, so drop them first.
    await auth.logout();
    await settings.save(req.body);
    res.json(await auth.status());
  });

  app.get('/auth/login', async (_req, res) => {
    res.redirect(await auth.beginLogin());
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state, error_description: description, error } = req.query;
    let failure = '';
    if (typeof code === 'string' && typeof state === 'string') {
      try {
        await auth.completeLogin(code, state);
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'Sign-in failed';
      }
    } else {
      failure = String(description ?? error ?? 'Sign-in was cancelled');
    }
    res.redirect(failure ? `/?auth_error=${encodeURIComponent(failure)}` : '/');
  });

  app.post('/auth/logout', async (_req, res) => {
    await auth.logout();
    res.json(await auth.status());
  });

  app.get('/api/templates', async (_req, res) => {
    res.json(await templates.list());
  });

  app.get('/api/templates/:id', async (req, res) => {
    const template = await templates.get(req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(template);
  });

  app.post('/api/templates', async (req, res) => {
    res.json(await templates.save(req.body));
  });

  app.delete('/api/templates/:id', async (req, res) => {
    const removed = await templates.remove(req.params.id);
    res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: 'Template not found' });
  });

  // Rendered by the same code that builds the real email, so the preview is exact.
  app.post('/api/preview', (req, res) => {
    const template = normaliseTemplate(req.body?.template);
    const to = typeof req.body?.recipients === 'string' ? req.body.recipients : '';
    const [first] = parseRecipients(to).recipients;
    res.json({ html: renderEmail(template, first ?? PREVIEW_RECIPIENT) });
  });

  app.post('/api/send', async (req, res) => {
    const template = normaliseTemplate(req.body?.template);
    const subject = text(req.body?.subject, 'Subject').trim();
    const { recipients, invalid } = parseRecipients(text(req.body?.recipients, 'To'));

    if (!subject) throw new BadRequest('Subject is required');
    if (invalid.length) throw new BadRequest(`Not a valid email address: ${invalid.join(', ')}`);
    if (!recipients.length) throw new BadRequest('Add at least one To address');

    // Fail before the first send rather than once per recipient.
    await auth.getToken();
    res.json({ results: await sendToAll(template, subject, recipients, transport) });
  });

  app.use(errorHandler);
  return app;
}
