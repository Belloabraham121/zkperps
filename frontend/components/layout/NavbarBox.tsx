"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useBalances } from "@/hooks/useAccount";
import { amountFromBigInt } from "@/lib/utils/perp";

export function NavbarBox() {
  const { logout, isAuthenticated } = useAuth();
  const { data: balances, isLoading: balancesLoading } = useBalances();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const usdcBalance =
    balances?.usdc != null ? amountFromBigInt(balances.usdc, 6) : 0;
  const displayBalance =
    !isAuthenticated
      ? "—"
      : balancesLoading
        ? "..."
        : usdcBalance.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

  useEffect(() => {
    if (balances != null) {
      console.log("[Navbar] balance", {
        endpoint: "GET /api/perp/balances",
        usdcContract: balances.usdcContract ?? "(not in response)",
        usdcRaw: balances.usdc,
        usdtRaw: balances.usdt,
        usdcFormatted: usdcBalance,
        displayBalance,
      });
    }
  }, [balances, usdcBalance, displayBalance]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#262626] bg-[#0a0a0a] px-4">
      {/* Logo + nav (left) — same as landing: ZKPerps + Syne */}
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-xl font-extrabold tracking-tight text-white hover:text-white/90"
          style={{ fontFamily: "var(--font-syne), sans-serif" }}
        >
          ZKPerps
        </Link>
        <nav className="flex gap-2">
          <Link
            href="/trade"
            className="px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            Trade
          </Link>
          <Link
            href="/execute"
            className="px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            Execute
          </Link>
        </nav>
      </div>

      {/* Right: Trading account balance + Profile */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-white/50">Trading account</span>
          <span className="text-sm font-medium text-white">{displayBalance}</span>
        </div>

        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex h-9 w-9 items-center justify-center bg-[#1a1a1a] text-white hover:bg-[#262626]"
            aria-label="Profile and settings"
            aria-expanded={profileOpen}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-45 border border-[#262626] bg-[#111111] py-1 shadow-lg">
              <a
                href="#profile"
                className="block px-3 py-2 text-sm text-white hover:bg-[#262626]"
                onClick={() => setProfileOpen(false)}
              >
                Profile
              </a>
              <a
                href="#settings"
                className="block px-3 py-2 text-sm text-white hover:bg-[#262626]"
                onClick={() => setProfileOpen(false)}
              >
                Settings
              </a>
              <a
                href="#preferences"
                className="block px-3 py-2 text-sm text-white hover:bg-[#262626]"
                onClick={() => setProfileOpen(false)}
              >
                Preferences
              </a>
              <div className="my-1 border-t border-[#262626]" />
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-[#262626]"
                onClick={() => {
                  setProfileOpen(false);
                  logout();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
