# GitHub App harness

The GitHub App is the identity wrapper (PR authorship, short-lived installation tokens, webhooks); a Claude agent will be the engine that makes the edits. See `PLAN.md` Phase 3. This folder is built in milestones:

| Milestone | Status |
| --- | --- |
| 0. `ChangeSpec` contract (`changeSpec.ts`) | done |
| 1. App skeleton: webhook receiver, installation store, token minting | done (this doc) |
| 2. Branch, commit, open a PR | next |
| 3. Agent session (Claude Agent SDK, no shell) | |
| 4. Post-run gate | |

## Register the GitHub App (one time, by hand)

1. Start a tunnel so GitHub can reach your machine. With Cloudflare: `cloudflared tunnel --url http://127.0.0.1:3000` (prints an `https://*.trycloudflare.com` URL; a quick tunnel's URL changes each run, so you'd update the App's webhook URL each time). ngrok works the same: `ngrok http 127.0.0.1:3000`.
2. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
   - **Webhook URL:** `<tunnel URL>/webhook`
   - **Webhook secret:** a long random string (e.g. `openssl rand -hex 32`). Put the same value in `.env`.
   - **Repository permissions:** Contents **Read and write**, Pull requests **Read and write**, Metadata **Read-only** (mandatory). Nothing else.
   - **Subscribe to events:** none are needed for milestone 1 beyond the installation events, which GitHub always sends. Pull request events come in milestone 6.
   - **Where can this App be installed:** *Only on this account* is fine for development; switch to *Any account* when other people install it.
3. After creating it: note the **App ID**, then **Generate a private key**. The `.pem` downloads once. Keep it out of the repo (`*.pem` is git-ignored).
4. **Install the App** on a test repo (the App's page → Install App).

## Run

```
cp .env.example .env        # fill in GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, key path
npm run harness             # webhook receiver on 127.0.0.1:$PORT
npm run harness:smoke -- owner/repo
```

Installing or uninstalling the App, or changing which repos it can see, should log an `installation ...` line and update `data/harness/installations.json`. In the App's **Advanced** tab GitHub lists recent deliveries and lets you redeliver one, which is the fastest way to debug the tunnel.

`harness:smoke` walks the whole auth chain against a real repo: App JWT, find the installation for that repo, mint an installation token, read the repo through it. It prints the installation's permissions so you can confirm `contents` and `pull_requests` are `write`.

## Behavior worth knowing

- The signature is verified against the raw body before anything is parsed. A bad or missing signature is a 401 and no handler runs.
- A handler failure returns 500, so GitHub shows the delivery as failed and can redeliver.
- The server binds to loopback only. The tunnel is the public face.
- Client-supplied repo names are matched case-insensitively (GitHub treats them that way).
- A repository event for an installation we never saw (the App was installed while the server was down) creates the record.
- A corrupt `installations.json` stops the server from writing rather than being silently overwritten.
