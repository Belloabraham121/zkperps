# zkperps Backend

Express + TypeScript backend. Uses **Privy** for auth (email sign-in) and **server-side signing** so the user never sees a transaction approval popup.

## Flow

1. **Frontend**: Sign up / login with email via [Privy’s email flow](https://docs.privy.io/authentication/user-authentication/login-methods/email) (`useLoginWithEmail` → `sendCode({ email })` → `loginWithCode({ code })`). Privy creates an embedded wallet and issues an access token.
2. **Frontend**: Call `POST /api/auth/signup` or `POST /api/auth/login` (or `POST /api/auth/verify-token`) with `{ accessToken }`. If the backend already has the wallet, you get a JWT and `signerId`.
3. **Frontend**: If the response says to link, call `addSigners({ address: user.wallet.address, signers: [{ signerId: response.signerId, policyIds: [] }] })` (Privy React), then `POST /api/auth/link` with `{ accessToken, walletAddress, walletId }`. Store the returned JWT.
4. **Backend**: All subsequent trading (e.g. `POST /api/trade/send`) uses the JWT. The backend looks up the user’s Privy wallet and sends the transaction via Privy’s API, signing with the app’s **authorization key** (key quorum). No user signature popup.

## Setup

1. Copy `.env.example` to `.env` and set:
   - `PRIVY_APP_ID`, `PRIVY_APP_SECRET` from [Privy Dashboard](https://dashboard.privy.io)
   - `JWT_SECRET` (e.g. `openssl rand -hex 32`)
   - `AUTHORIZATION_PRIVATE_KEY_PATH`: path to the PEM file of your app signer key
   - `PRIVY_KEY_QUORUM_ID`: ID of the key quorum created in Privy (Authorization keys → New key quorum)
   - `RPC_URL` (Arbitrum Sepolia or your chain)

2. **App authorization key (one-time)**  
   So the backend can sign on behalf of users:
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out private.pem
   openssl ec -in private.pem -pubout -out public.pem
   ```
   In Privy Dashboard → **Authorization keys** → **New key quorum**: paste the **public** key, set threshold 1, save. Use the quorum **id** as `PRIVY_KEY_QUORUM_ID`. Keep `private.pem` only on the server and set `AUTHORIZATION_PRIVATE_KEY_PATH` to it.

3. Run:
   ```bash
   npm install
   npm run dev
   ```

## API

- `POST /api/auth/signup` — Body: `{ accessToken }`. Use after Privy email signup. Same as login.
- `POST /api/auth/login` — Body: `{ accessToken }`. Use after Privy email login. Returns JWT + `walletAddress` + `signerId` if linked, else instructions to link.
- `POST /api/auth/verify-token` — Same as login.
- `POST /api/auth/link` — Body: `{ accessToken, walletAddress, walletId? }`. Links wallet and returns JWT + `signerId`.
- `GET /api/auth/me` — Header: `Authorization: Bearer <jwt>`. Returns current user.
- `POST /api/trade/send` — Header: `Authorization: Bearer <jwt>`. Body: `{ to, value?, data? }`. Sends a transaction from the user’s wallet (backend signs).

Wallet linking is in-memory; replace with a DB in production.
