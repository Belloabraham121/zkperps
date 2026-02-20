"use client";

import { useAuth } from "@/lib/auth";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AuthGuardProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Component that protects routes requiring authentication
 */
export function AuthGuard({ children, redirectTo = "/" }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { ready } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isLoading && !isAuthenticated) {
      router.push(redirectTo);
    }
  }, [ready, isLoading, isAuthenticated, redirectTo, router]);

  if (!ready || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
