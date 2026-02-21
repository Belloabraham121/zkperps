# Frontend Auth Setup with Privy

This guide explains how to set up authentication in the frontend using Privy SDK.

## Prerequisites

1. **Privy App ID**: Get your Privy App ID from [Privy Dashboard](https://dashboard.privy.io)
2. **Backend Running**: Ensure your backend server is running on `http://localhost:4000` (or update `NEXT_PUBLIC_API_URL`)

## Setup Steps

### 1. Environment Variables

Create a `.env.local` file in the `frontend` directory:

```bash
# Privy App ID (from https://dashboard.privy.io)
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here

# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### 2. Install Dependencies

Dependencies are already installed, but if you need to reinstall:

```bash
npm install
```

### 3. Run the Development Server

```bash
npm run dev
```

## How It Works

### Authentication Flow

1. **User clicks "Sign In"** → Privy modal opens
2. **User enters email** → Privy sends OTP code
3. **User enters OTP** → Privy authenticates user
4. **Frontend gets Privy access token** → Calls backend `/api/auth/login` or `/api/auth/signup`
5. **Backend verifies token** → Returns JWT + wallet info
6. **If wallet not linked** → Frontend links wallet and adds backend signer
7. **User is authenticated** → Can access protected routes

### Components

- **`LoginButton`**: Button to trigger Privy login modal
- **`UserProfile`**: Shows user email/wallet and logout button
- **`AuthGuard`**: Protects routes requiring authentication
- **`useAuth` hook**: Manages auth state and syncs with backend

### Usage Examples

#### Using Auth Hook

```tsx
import { useAuth } from "@/lib/auth";

function MyComponent() {
  const { isAuthenticated, token, user, login, logout, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  
  if (!isAuthenticated) {
    return <button onClick={login}>Sign In</button>;
  }

  return (
    <div>
      <p>Welcome, {user?.email}</p>
      <p>Wallet: {user?.walletAddress}</p>
      <button onClick={logout}>Sign Out</button>
    </div>
  );
}
```

#### Protecting Routes

```tsx
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function ProtectedPage() {
  return (
    <AuthGuard>
      <div>This content is only visible to authenticated users</div>
    </AuthGuard>
  );
}
```

#### Making Authenticated API Calls

```tsx
import { useAuth } from "@/lib/auth";

function MyComponent() {
  const { token } = useAuth();

  async function fetchData() {
    const res = await fetch("http://localhost:4000/api/some-endpoint", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    // ...
  }
}
```

## Features

- ✅ Email-based authentication (OTP)
- ✅ Automatic embedded wallet creation
- ✅ Backend signer setup (for server-signed transactions)
- ✅ JWT token management
- ✅ Protected route guards
- ✅ Automatic wallet linking

## Troubleshooting

### "NEXT_PUBLIC_PRIVY_APP_ID is not set"

Make sure you've created `.env.local` with your Privy App ID.

### "Failed to link wallet"

- Ensure backend is running
- Check that `PRIVY_APP_ID` and `PRIVY_APP_SECRET` are set in backend `.env`
- Verify backend can verify Privy access tokens

### "Failed to add signer"

- Ensure `PRIVY_KEY_QUORUM_ID` is set in backend `.env`
- Verify the key quorum is registered in Privy Dashboard
- Check that the authorization key is properly configured

## Next Steps

- Add more login methods (social, wallet connect, etc.)
- Implement refresh token logic
- Add user profile management
- Create protected trading pages
