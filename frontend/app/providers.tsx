"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import "@/lib/suppress-extension-errors";

function isPrivyAuthTimeout(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("auth.privy.io") ||
    (msg.includes("sessions") && (msg.includes("timeout") || msg.includes("TimeoutError")))
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isPrivyAuthTimeout(event.reason)) {
        console.warn("[Privy] Auth request timed out. Check your network or try again.", event.reason);
        toast.error(
          "Authentication service timed out. Check your internet connection and try again.",
          { id: "privy-timeout", duration: 8000 }
        );
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!privyAppId) {
    console.warn("NEXT_PUBLIC_PRIVY_APP_ID is not set. Please add it to .env.local");
  }

  return (
    <PrivyProvider
      appId={privyAppId || ""}
      config={{
        loginMethods: ["email"],
        appearance: {
          theme: "light",
          accentColor: "#676FFF",
        },
        embeddedWallets: {
          createOnLogin: "all-users", // Create wallet immediately for all users on login
        },
      }}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PrivyProvider>
  );
}
