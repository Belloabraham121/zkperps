"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";

const TRADING_ACCOUNT_BALANCE = "$27,594.09";

export function NavbarBox() {
  const { logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#363d4a] bg-[#21262e] px-4">
      {/* Logo (left) */}
      <div className="flex items-center gap-2">
        <a href="/" className="flex items-center gap-2 font-semibold text-[#c8cdd4] hover:text-white">
          <span className="flex h-8 w-8 items-center justify-center bg-[#3d4a5c] text-sm font-bold text-white">
            z
          </span>
          <span className="hidden sm:inline">zkperps</span>
        </a>
      </div>

      {/* Right: Trading account balance + Profile */}
      <div className="flex items-center gap-3">
        {/* Trading account with balance */}
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Trading account</span>
          <span className="text-sm font-medium text-[#c8cdd4]">{TRADING_ACCOUNT_BALANCE}</span>
        </div>

        {/* Profile icon + dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex h-9 w-9 items-center justify-center bg-[#2a303c] text-[#c8cdd4] hover:bg-[#363d4a]"
            aria-label="Profile and settings"
            aria-expanded={profileOpen}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] border border-[#363d4a] bg-[#2a303c] py-1 shadow-lg">
              <a
                href="#profile"
                className="block px-3 py-2 text-sm text-[#c8cdd4] hover:bg-[#363d4a]"
                onClick={() => setProfileOpen(false)}
              >
                Profile
              </a>
              <a
                href="#settings"
                className="block px-3 py-2 text-sm text-[#c8cdd4] hover:bg-[#363d4a]"
                onClick={() => setProfileOpen(false)}
              >
                Settings
              </a>
              <a
                href="#preferences"
                className="block px-3 py-2 text-sm text-[#c8cdd4] hover:bg-[#363d4a]"
                onClick={() => setProfileOpen(false)}
              >
                Preferences
              </a>
              <div className="my-1 border-t border-[#363d4a]" />
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-[#c8cdd4] hover:bg-[#363d4a]"
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
