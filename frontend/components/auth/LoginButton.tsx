"use client";

import { useAuth } from "@/lib/auth";
import { usePrivy } from "@privy-io/react-auth";

export function LoginButton({
  variant = "default",
  size = "md",
}: {
  variant?: "default" | "sharp";
  size?: "sm" | "md";
}) {
  const { login, isAuthenticated, isLoading } = useAuth();
  const { ready } = usePrivy();

  const sharpClass =
    size === "sm"
      ? "inline-flex h-9 items-center justify-center border-0 bg-[#22c55e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1ea34e]"
      : "inline-flex h-12 items-center justify-center border-0 bg-[#22c55e] px-8 text-base font-semibold text-white transition-colors hover:bg-[#1ea34e]";

  if (!ready || isLoading) {
    return (
      <button
        disabled
        className={
          variant === "sharp"
            ? `inline-flex items-center justify-center border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-muted)] cursor-not-allowed ${size === "sm" ? "h-9 px-4 text-sm" : "h-12 px-8 text-base"}`
            : "px-4 py-2 rounded-lg bg-gray-300 text-gray-600 cursor-not-allowed"
        }
        style={variant === "sharp" ? { borderRadius: 0 } : undefined}
      >
        Loading...
      </button>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  return (
    <button
      onClick={login}
      className={
        variant === "sharp"
          ? sharpClass
          : "px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      }
      style={variant === "sharp" ? { borderRadius: 0 } : undefined}
    >
      Sign In
    </button>
  );
}
