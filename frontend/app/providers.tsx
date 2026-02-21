"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { useState, useEffect } from "react";
import "@/lib/suppress-extension-errors";

export function Providers({ children }: { children: React.ReactNode }) {
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
