# CLAUDE.md — Email_Sender

Project config. Overrides `Engineering/CLAUDE.md` where they conflict.

Written by hand: `Engineering/PROJECT_CLAUDE_TEMPLATE.md` did not exist at kickoff. Regenerate from the template once it does.

## What it is

Web app, run locally or on Vercel, that sends one templated HTML email per recipient from the user's own mailbox over SMTP. The owner's mailbox is a custom-domain mailbox hosted through GoDaddy.

## Stack

- Node.js 22, TypeScript (ESM, run with `tsx`, no build step)
- Express 5 server, plain HTML/CSS/JS front end in `public/` (no framework, no bundler)
- `nodemailer` over SMTP with TLS to send
- Vitest with v8 coverage

## Commands

- `npm start` — run on http://localhost:3000
- `npm test` — tests with coverage, fails under 80% lines
- `npm run typecheck` — `tsc --noEmit`

## Layout

- `src/server.ts` — local wiring only, excluded from coverage
- `src/hosted.ts` — online (Vercel) wiring from environment variables; `api/index.ts` exports it for Vercel
- `src/login.ts` — shared-password login with signed session cookies (online only)
- `src/blobStorage.ts` — Vercel Blob backend for templates and uploaded images
- `src/app.ts` — routes, access guards, error mapping
- `src/render.ts` — template fields to email HTML. All user text is escaped here
- `src/recipients.ts` — To list parsing
- `src/templateStore.ts` — template validation over a pluggable backend (disk, read-only, Blob with seeding)
- `src/settings.ts` — mailbox settings from a local file or from `SMTP_*` environment variables
- `src/smtp.ts` — nodemailer transport, login check, error wording
- `templates/` — saved templates, committed
- `.data/` — mailbox address and password, never committed

## Decisions

- **SMTP with a mailbox password, not Microsoft Graph.** The mailbox is hosted by GoDaddy, not Microsoft, so there is no Graph mailbox to send from. The first version used Graph on the wrong assumption; it is in git history before this change.
- **Encrypted ports only** (465 implicit TLS, 587 with required STARTTLS).
- **Login is tested before settings are saved**, so a wrong password is caught at setup, not at send.
- **One email per recipient**, never a shared To line. Clients must not see each other's addresses.
- **Fixed sections, editable fields and order.** Templates are data, not HTML. Each section is built on its own in `render.ts` and output in `Template.order`, so every section must look right next to any other. A new section needs an entry in `SECTIONS`, its fields in `Template`, and a field group plus label in `public/`.
- **Video is a linked picture**, never an embedded player. Mail clients strip video.
- **Preview is rendered server-side** by the same `renderEmail` used for sending, so the two cannot drift.
- Email HTML is table-based with inline styles for Outlook compatibility. Keep it that way.
- **Two access modes.** Locally the server binds to `127.0.0.1` and rejects foreign `Host`/`Origin` headers. Online every request needs a login, and requests from other origins are refused. Never serve the app online without the login.
- **Online fails closed.** Without `APP_PASSWORD` (12+ characters) the hosted app answers only with a setup message.
- **Online settings come from the environment.** Vercel's disk is read-only and ephemeral, so the mailbox is `SMTP_*` variables and templates and uploads live in Vercel Blob. The store is public because images must load in mail apps; template blobs use random suffixes.
- **Vercel config** is the legacy `builds` setup in `vercel.json`, which routes everything to `api/index.ts`. It was made to work by the owner; change it with care.

## Rules

- The password is never returned by the API, never logged, never committed. Nothing under `.data/` leaves the machine.
- An empty password on save keeps the stored one only for the same mailbox and server.
- `APP_PASSWORD` and `SMTP_PASSWORD` live only in Vercel environment variables.
- Tests inject a fake mailer and a fake Blob client. Tests must never log in to a real server or send real mail.
- Coverage floor: 80% lines.

## Open items

- `hooks-templates/` and `ci-templates/` did not exist at the Engineering root at kickoff, so no hooks or CI are applied yet.
