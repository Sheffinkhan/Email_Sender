# Email_Sender

Send a branded, templated email to clients from your own mailbox. Runs as a small web page on your own PC.

- **From** is the mailbox you connect, for example `info@yourdomain.com`, with the sender name you choose.
- **To** takes one or many addresses. Each person gets their own separate email and cannot see the others.
- **Subject** is typed per send.
- **Template** is edited through plain fields with a live preview. Save as many templates as you like.

## Run it

Needs Node.js 22 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000.

## Connect your email (one time)

The page asks for this the first time:

1. **Email address** and **Password**: the ones you use to read the mailbox.
2. **Your name**: what clients see as the sender.
3. **Email provider**: pick yours. This fills in the sending server.
4. Press **Save and test**. The app logs in to check the details and saves them only if the login works.

| Provider | Sending server | Port |
| --- | --- | --- |
| GoDaddy Workspace Email | `smtpout.secureserver.net` | 465 |
| Titan (GoDaddy Professional Email) | `smtp.titan.email` | 465 |
| Other | Ask your provider for its SMTP server | 465 or 587 |

Not sure which provider you have? Look up your domain's SPF record: `include:secureserver.net` means GoDaddy Workspace Email, `include:spf.titan.email` means Titan. Sending through the wrong one also makes emails fail spam checks.

If the login is refused: use the mailbox's own password (the one for webmail), not your GoDaddy account password. On Titan, also switch on access from other mail apps in the mailbox settings.

The connection is always encrypted. Ports without encryption are not offered.

## Online version (Vercel)

The same app runs on Vercel, behind a password. Vercel deploys every push to `main` automatically.

### One-time setup in Vercel

Open the project in the Vercel dashboard.

1. **Storage** tab: create a **Blob** store with **public** access and connect it to this project. This adds `BLOB_READ_WRITE_TOKEN` by itself. Public access is needed so uploaded images show in your clients' mail apps; saved templates get random, unguessable addresses.
2. **Settings > Environment Variables**: add these for Production.

| Variable | Value |
| --- | --- |
| `APP_PASSWORD` | The password for the login page. At least 12 characters. |
| `SMTP_USER` | The mailbox to send from, for example `info@yourdomain.com` |
| `SMTP_PASSWORD` | That mailbox's password |
| `SMTP_FROM_NAME` | The sender name clients see (optional) |
| `SMTP_HOST` | Optional. Defaults to `smtpout.secureserver.net` (GoDaddy Workspace Email) |
| `SMTP_PORT` | Optional. `465` (default) or `587` |

3. **Deployments**: redeploy the latest deployment so the new variables take effect.

Until `APP_PASSWORD` is set, the site only shows a message saying so. Without a Blob store, templates can be used but not saved.

### Online differences

- The mailbox is changed in Vercel, not in the page. **Connection > Test login** checks it works.
- Uploaded images are stored in Blob and linked from the email instead of attached. Some mail apps (Outlook especially) ask the reader before showing linked images.
- Uploads are limited to 2 MB each.
- The login lasts 7 days. Changing `APP_PASSWORD` signs everyone out.

## Writing a template

Empty fields are left out of the email. Text fields understand:

| You type | You get |
| --- | --- |
| `{{name}}` | The client's name, or "there" when no name was given |
| `{{email}}` | The client's email address |
| `**bold**` | **bold** |
| `[text](https://example.com)` | A link |
| `## Title` | A section heading |
| A blank line | A new paragraph |

`{{name}}` also works in the Subject. To give a name, write the address as `Name <email>`:

```
Priya Nair <priya@client.com>, ben@client.com
```

Logo and banner can be a web address or an uploaded file (up to 1 MB). Uploaded images are attached inside the email, so they show without hosting.

### Rearranging the email

The **Layout** list shows the parts of the email from top to bottom. Drag a part with the mouse (or a finger on a touch screen) to move it. The preview and the form follow, and the order is saved with the template. With the keyboard, select a part and press the up or down arrow.

### GIF and video

- **GIF:** put it in **GIF or picture** (link or upload, up to 2 MB). It appears under the opening text and animates in Outlook on the web, new Outlook, Gmail and Apple Mail. Older Outlook desktop versions show only the first frame, so make the first frame meaningful.
- **Video:** email programs do not play video inside a message. Paste the video's address into **Video link**. The picture becomes clickable and a "Watch the video" link is added under it. A YouTube link gets its preview picture automatically. For other videos, add your own picture or GIF.

Templates are stored as JSON files in `templates/`.

## Good to know

- Your provider limits how many emails a mailbox may send per hour and per day. Large lists may hit it; the page shows which addresses failed.
- A copy may not appear in the mailbox's Sent folder. That depends on the provider.
- The email address and password are kept in `.data/settings.json` on this PC, unencrypted, so you stay connected between runs. That folder is ignored by git. Do not share it. **Disconnect** in the page deletes it.
- The page only answers on this PC (`127.0.0.1`).
- A different port: set `PORT` before `npm start`.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` runs the unit tests with coverage and fails under 80% line coverage.
