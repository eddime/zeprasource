# OAuth setup (Google & Microsoft)

Zepra uses OAuth 2.0 with PKCE and a **local callback** on your machine. Tokens never leave your device except to talk to Google/Microsoft and your IMAP servers.

## Redirect URI (both providers)

Register this exact redirect URI in each OAuth app:

```
http://127.0.0.1:45821/callback
```

Zepra starts a short-lived local server on port `45821` during sign-in.

## Google (Gmail)

1. Open [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth client ID** (type: **Desktop app** or **Web application** with the redirect above).
3. Enable the **Gmail API** for the project (if prompted).
4. Under OAuth consent screen, add the scope `https://mail.google.com/` (or full Gmail access for IMAP).
5. Copy **Client ID** and **Client secret** into `mailport/.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Microsoft (Outlook / Microsoft 365)

1. Open [Azure Portal](https://portal.azure.com/) → Microsoft Entra ID → App registrations → New registration.
2. Add redirect URI: **Web** → `http://127.0.0.1:45821/callback`.
3. Certificates & secrets → New client secret.
4. API permissions → Add **Office 365 Exchange Online** → `IMAP.AccessAsUser.All` (delegated), plus `offline_access`, `openid`, `profile`, `email` if not present.
5. Copy Application (client) ID and secret into `.env`:

```env
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

## Using OAuth in the app

1. Copy `.env.example` to `.env` and fill in the values.
2. Restart the app (`bun run dev` or a fresh build).
3. On the setup screen, choose **Gmail** or **Outlook** and click **Sign in with Google** or **Sign in with Microsoft**.
4. Complete sign-in in the system browser; Zepra verifies the connection automatically.

If buttons do not appear, the corresponding env vars are missing.

## Security notes

- `.env` is gitignored; never commit client secrets.
- Refresh tokens are stored in the encrypted local credential vault.
- You can still use an **app password** instead of OAuth (divider on the mailbox card).

## Publishing for everyone (production)

During development, Google blocks all accounts except **Test users** on the OAuth consent screen. That is expected.

To let **any** Gmail user sign in, you must move the app to **Production** and pass **Google’s app verification** — because Zepra uses the restricted scope `https://mail.google.com/` (full IMAP access).

### What you need before “Publish app”

| Requirement | Notes |
|-------------|--------|
| **OAuth consent screen** | App name “Zepra”, logo, support email, developer contact |
| **Privacy policy URL** | Public HTTPS page explaining local-first processing, what is stored on device, no cloud relay |
| **Homepage / app website** | e.g. `https://zepra.app` or GitHub Pages — what Zepra does |
| **Terms of service** (recommended) | Optional but helps verification |
| **Scope justification** | Plain language: “Migrate mail between IMAP accounts on the user’s computer only” |
| **Demo video** | Screen recording: install → Gmail OAuth → migration, showing data stays local |
| **Separate Cloud project** | Google recommends a **production** project distinct from your sandbox |

Official guides:

- [Production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

### Timeline (realistic)

- **Test users only:** minutes (current setup)
- **Unverified production:** users see “App not verified” and must click through — poor UX, not acceptable for a consumer product
- **Verified restricted scope:** often **several weeks to months**; Google may request a **security assessment** (paid third party) if they classify your app as high risk

Plan for verification early; ship **app passwords** as a fallback until Google approves.

### Microsoft (Outlook)

For “everyone”, the Entra app must support **multitenant** sign-in (`common` authority — Zepra already uses this) and you may need **Microsoft publisher verification** and admin consent policies for organizational accounts. Personal Outlook.com accounts usually work after app registration is complete.

### How end users get OAuth (not `.env`)

Today, **you** put client credentials in `mailport/.env` for local development.

For a public Zepra release:

1. **One** Google Cloud OAuth client for all users (your brand).
2. Ship the **Client ID** inside the app (public).
3. Keep the **client secret** out of the repo if possible; desktop apps should rely on **PKCE** (Zepra already does).
4. End users never create their own Google Cloud project or `.env`.

Until that packaging exists, only your machine can use your `.env` credentials.

### Checklist: Test → Production

1. **Now:** Add test users → develop and demo.
2. **Before launch:** Privacy policy + website live.
3. **Google Cloud:** OAuth consent screen → **Publish app** → submit verification for `https://mail.google.com/`.
4. **Zepra release build:** Embed production `GOOGLE_CLIENT_ID` (and Microsoft ID) in the app binary, not user-supplied `.env`.
5. **After approval:** Any Gmail user can use “Sign in with Google” without being on the test list.
