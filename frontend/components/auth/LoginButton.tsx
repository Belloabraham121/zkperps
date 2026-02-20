"use client";

import { useAuth } from "@/lib/auth";
import { usePrivy } from "@privy-io/react-auth";

export function LoginButton() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const { ready } = usePrivy();

  if (!ready || isLoading) {
    return (
      <button
        disabled
        className="px-4 py-2 rounded-lg bg-gray-300 text-gray-600 cursor-not-allowed"
      >
        Loading...
      </button>
    );
  }

  if (isAuthenticated) {
    return null; // User is logged in, show logout button instead
  }

  return (
    <button
      onClick={login}
      className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
    >
      Sign In
    </button>
  );
}
