# MailPort

Privacy-focused, local-first IMAP email migration for macOS, Windows, and Linux.

MailPort transfers email **directly between IMAP servers on your machine**. No cloud relay, no uploads, no telemetry.

## Stack

- [Electrobun](https://electrobun.dev) — native desktop shell (Bun runtime)
- Vue 3 + TypeScript + Vite
- Tailwind CSS v4
- Pinia
- SQLite (`bun:sqlite`) for migration state & history
- [ImapFlow](https://imapflow.com) for IMAP

## Features

- Source & destination mailbox setup (Gmail, Outlook, iCloud, generic IMAP)
- Credential validation & folder listing
- Streaming IMAP→IMAP transfer with UID tracking
- Folder structure, flags, timestamps, duplicate detection
- Parallel workers with retries
- Live progress via RPC messages
- Resume failed/paused migrations
- Encrypted local credential vault
- Google & Microsoft OAuth sign-in (see [docs/OAUTH.md](docs/OAUTH.md))
- Stripe per-GB migration pricing (see [docs/STRIPE.md](docs/STRIPE.md))

## Development

### Hot reload (recommended)

```bash
cd mailport
bun install
bun run dev          # alias for dev:hmr
```

This starts:

1. **Vite** on `http://localhost:5180` — instant Vue/CSS HMR in the app window
2. **Electrobun** with `--watch` — restarts the Bun main process when `src/bun/` changes

The desktop app loads the Vite dev server only when it sees the `X-Zepra-Dev` header (so it never picks up another project on port 5173).

### OAuth & Stripe (optional)

```bash
cp .env.example .env
# Google/Microsoft — docs/OAUTH.md
# Paid migrations — docs/STRIPE.md (STRIPE_SECRET_KEY + Dashboard price/metadata)
```

### Other commands

```bash
bun run start        # production UI build + dev app (no HMR)
bun run dev:ui       # Vite only
bun run dev:bun      # Electrobun watch only (bundled UI from last build)
bun run build:ui     # build Vue UI only
bun run build:canary # production-ish bundle
```

## Project layout

```
src/
  bun/           # Main process: IMAP, migration engine, SQLite, RPC
  mainview/      # Vue UI
  shared/        # Shared TypeScript types
```

## Privacy

- All migration metadata lives in your OS user data directory (`Utils.paths.userData`).
- Credentials are encrypted at rest (AES-256-GCM, machine-derived key).
- Email bodies are streamed through memory — never written to logs.
- No external servers except your IMAP hosts.

## License

MIT
