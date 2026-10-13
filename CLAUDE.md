# CLAUDE.md — Email_Sender

Project config. Overrides `Engineering/CLAUDE.md` where they conflict.

Written by hand: `Engineering/PROJECT_CLAUDE_TEMPLATE.md` did not exist at kickoff. Regenerate from the template once it does.

## What it is

Local web app that sends one templated HTML email per recipient from the user's Outlook mailbox.

## Stack

- Node.js 22, TypeScript (ESM, run with `tsx`, no build step)
- Express 5 server, plain HTML/CSS/JS front end in `public/` (no framework, no bundler)
- `@azure/msal-node` for Microsoft sign-in, Microsoft Graph `POST /me/sendMail` to send
- Vitest with v8 coverage

## Commands

- `npm start` — run on http://localhost:3000
- `npm test` — tests with coverage, fails under 80% lines
- `npm run typecheck` — `tsc --noEmit`

## Layout

- `src/server.ts` — wiring only, excluded from coverage
- `src/app.ts` — routes, local-only guard, error mapping
- `src/render.ts` — template fields to email HTML. All user text is escaped here
- `src/recipients.ts` — To list parsing
- `src/templateStore.ts`, `src/settings.ts` — JSON file storage and validation
- `src/graph/` — MSAL sign-in (`auth.ts`, `msal.ts`) and Graph send (`transport.ts`)
- `templates/` — saved templates, committed
- `.data/` — client ID settings and token cache, never committed

## Decisions

- **Microsoft Graph, not Outlook desktop automation or SMTP.** Classic Outlook on the dev machine has no account and Office is unlicensed. Basic-auth SMTP is being retired by Microsoft.
- **One email per recipient**, never a shared To line. Clients must not see each other's addresses.
- **Fixed sections, editable fields and order.** Templates are data, not HTML. Each section is built on its own in `render.ts` and output in `Template.order`, so every section must look right next to any other. A new section needs an entry in `SECTIONS`, its fields in `Template`, and a field group plus label in `public/`.
- **Video is a linked picture**, never an embedded player. Mail clients strip video.
- **Preview is rendered server-side** by the same `renderEmail` used for sending, so the two cannot drift.
- Email HTML is table-based with inline styles for Outlook compatibility. Keep it that way.
- The server binds to `127.0.0.1` and rejects foreign `Host`/`Origin` headers, because it holds a mailbox token.

## Rules

- Only the `Mail.Send` scope. Do not widen it without a stated reason.
- Never log or commit tokens. Nothing under `.data/` leaves the machine.
- Tests inject fakes for MSAL and `fetch`. Tests must never call Microsoft or send real mail.
- Coverage floor: 80% lines.

## Open items

- `hooks-templates/` and `ci-templates/` did not exist at the Engineering root at kickoff, so no hooks or CI are applied yet.
