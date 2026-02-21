# What to Paste in Privy Dashboard for Authorization Key

Your backend uses **server-side signing**: it signs transactions with the key in `private.pem`. Privy must have the **matching public key** registered. If the public key in Privy doesn’t match `private.pem`, you get **"Invalid wallet authorization private key"**.

The backend reads your PEM file and converts it to the format Privy’s SDK expects (base64 PKCS8) automatically. Keep using `private.pem` as-is.

---

## Important: Two Different Dashboard Flows

1. **"New key"** (Privy generates the key)  
   Privy creates a keypair and shows you a **private key** to copy. You do **not** paste anything.  
   If you used this flow, the key in your `private.pem` (from openssl) **does not** match that quorum. Either:
   - Replace `private.pem` with the private key Privy gave you and use that quorum’s ID in `.env`, or  
   - Ignore that quorum and use **Register key quorum** below with your existing `public.pem`.

2. **"Register key quorum"** (you already have a keypair)  
   You paste **your** public key so it matches your `private.pem`. Use this if you generated the key with openssl and have `private.pem` + `public.pem`.

---

## What to Paste (when using your existing key)

Privy expects the public key in **base64-encoded DER** format, **not** the raw PEM.

### 1. Get the value to paste

From the `backend` folder run:

```bash
openssl ec -pubin -in public.pem -outform DER | base64
```

Copy the **entire** output (one line). For your current `public.pem` it is:

```
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErK+0FQ9oVBfUKJ/HnSZMYU5sdI7eriDoAmo3VkHwtHpqTTf/CX4ix8V28jywfy4odWAvannTCVxrLtsE1iEySQ==
```

### 2. In Privy Dashboard

1. Go to **Privy Dashboard** → your app → **Wallets** → **Authorization keys**.
2. Click **New key**.
3. Choose **Register key quorum** (not the option where Privy generates the key).
4. In the field for **public key(s)**:
   - Paste **only** the base64 string above (no `-----BEGIN PUBLIC KEY-----`, no line breaks, no spaces).
5. Set **Authorization threshold** to **1**.
6. Set a **Name** (e.g. "Backend signer") and save.
7. Copy the **Key quorum ID** (e.g. `abc123xyz`).

### 3. In your backend `.env`

Set:

```env
PRIVY_KEY_QUORUM_ID=<the-key-quorum-id-you-just-copied>
```

Keep:

```env
AUTHORIZATION_PRIVATE_KEY_PATH=./private.pem
```

Restart the backend. The key in `private.pem` and the key you registered in Privy will match, and "Invalid wallet authorization private key" should stop.

---

## Summary

| Where              | What to use                                                                 |
|--------------------|-----------------------------------------------------------------------------|
| **Privy Dashboard**| Paste the **base64 DER** of your public key (from `openssl ... \| base64`). |
| **Do not paste**   | The PEM block from `public.pem` (no `-----BEGIN PUBLIC KEY-----` etc.).   |
| **Backend `.env`** | `PRIVY_KEY_QUORUM_ID` = the ID of the quorum you created in the Dashboard.  |

**Note:** The backend converts your `private.pem` (PEM format) to base64 PKCS8 internally before sending to Privy. No need to change the private key file.
