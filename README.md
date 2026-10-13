# Email_Sender

Send a branded, templated email to clients from your Outlook mailbox. Runs as a small web page on your own PC.

- **From** is the Outlook account you sign in with. A copy of every email lands in its Sent Items.
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

## Connect Outlook (one time)

Microsoft requires an app registration before any program may send from a mailbox. The page walks you through it the first time:

1. Open [Microsoft Entra > App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and choose **New registration**.
2. Name it `Email Sender`. Under supported account types pick **Accounts in any organizational directory and personal Microsoft accounts**.
3. Under Redirect URI pick **Public client/native (mobile & desktop)** and enter `http://localhost:3000/auth/callback`.
4. Press **Register** and copy the **Application (client) ID**.
5. Paste it into the page, press **Save connection**, then **Sign in to Outlook**.

The only permission requested is `Mail.Send`. If a company account shows "Need admin approval", your Microsoft 365 admin has to approve the app once.

Leave Tenant as `common`. Use a tenant ID only if the app was registered for a single organisation.

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
- All uploads together must stay under about 2.5 MB per email. For a larger GIF, host it online and paste its link.

Templates are stored as JSON files in `templates/`.

## Good to know

- Outlook limits how many emails an account may send per day (about 300 for personal Outlook.com accounts, far more for Microsoft 365). Large lists may hit it.
- The sign-in is kept in `.data/` on this PC so you stay signed in between runs. That folder is ignored by git. Treat it like a password and do not share it. **Sign out** in the page removes it.
- The page only answers on this PC (`127.0.0.1`).
- A different port: set `PORT` before `npm start` and register the matching redirect URI.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` runs the unit tests with coverage and fails under 80% line coverage.
