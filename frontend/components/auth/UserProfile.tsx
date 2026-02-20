"use client";

import { useAuth } from "@/lib/auth";
import { formatAddress } from "@/lib/utils";

export function UserProfile() {
  const { isAuthenticated, user, logout, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
        <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex flex-col items-end">
        {user.email && (
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {user.email}
          </span>
        )}
        {user.walletAddress && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatAddress(user.walletAddress)}
          </span>
        )}
      </div>
      <button
        onClick={logout}
        className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors text-sm"
      >
        Sign Out
      </button>
    </div>
  );
}
