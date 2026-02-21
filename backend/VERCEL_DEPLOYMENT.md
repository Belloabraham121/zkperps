# Deploying the backend to Vercel

## 1. Project setup

- In [Vercel](https://vercel.com), create a new project and connect your repo.
- Set **Root Directory** to `backend` (if the repo is the full monorepo).
- Vercel will detect the Express app from `src/index.ts` (default export).

## 2. Environment variables

In the Vercel project → **Settings → Environment Variables**, add all variables from `.env.example`. In particular:

### Private key (no file upload)

You cannot upload `private.pem` on Vercel. Use the **PEM string** in an env var instead:

- **Name:** `AUTHORIZATION_PRIVATE_KEY`
- **Value:** the full contents of your `private.pem`, in one of these forms:
  - **Multi-line (recommended):** paste the PEM as-is, including the `-----BEGIN ... -----` and `-----END ... -----` lines. Vercel supports multi-line values.
  - **Single-line:** replace every real newline with the two characters `\n`, e.g.  
    `-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEI...\n-----END EC PRIVATE KEY-----`

Do **not** set `AUTHORIZATION_PRIVATE_KEY_PATH` when using `AUTHORIZATION_PRIVATE_KEY`. The app uses the env value if present, otherwise the file path.

### Other required vars

- `MONGODB_URI`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_KEY_QUORUM_ID`
- `JWT_SECRET`, `RPC_URL`, `CHAIN_ID`, and any contract addresses you override

## 3. Deploy

- Push to your connected branch or run `vercel` from the `backend` directory.
- The backend will be a single serverless function; MongoDB is connected on first request.

## 4. Keeper / long-running jobs

The perp batch **keeper** (auto-execute on an interval) is **not** started on Vercel, because serverless functions are request-scoped. To run batches automatically, use a separate cron (e.g. Vercel Cron or an external service) that calls `POST /api/perp/execute` on a schedule, or run the keeper in a long-running process elsewhere.
