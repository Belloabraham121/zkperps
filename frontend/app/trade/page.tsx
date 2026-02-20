"use client";

import { TradeLayout } from "@/components/layout/TradeLayout";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function TradePage() {
  return (
    <AuthGuard>
      <TradeLayout />
    </AuthGuard>
  );
}
