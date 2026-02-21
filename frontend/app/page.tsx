"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { LoginButton } from "@/components/auth/LoginButton";
import { UserProfile } from "@/components/auth/UserProfile";
import { useAuth } from "@/lib/auth";

const SentientSphere = dynamic(
  () =>
    import("@/components/landing/SentientSphere").then((m) => m.SentientSphere),
  { ssr: false },
);

const FEATURES = [
  {
    title: "Private execution",
    description:
      "Orders are committed then revealed in batches. Your size, direction, and slippage never appear in public calldata — only aggregate net flow hits the AMM.",
  },
  {
    title: "Zero-knowledge proofs",
    description:
      "Every commitment is verified on-chain with a ZK proof. Validity is proven without exposing your trade parameters.",
  },
  {
    title: "Perpetual futures",
    description:
      "Trade ETH/USD perps with leverage. Live prices, chart, order panel with size and margin — and an estimated liquidation price before you open.",
  },
  {
    title: "No wallet popups",
    description:
      "Sign in with email. The backend signs for you so you don't approve every commit or reveal — seamless trading.",
  },
  {
    title: "Batch execution",
    description:
      "Reveals are batched and executed in one go. Same infrastructure can power autonomous agents doing private batched swaps.",
  },
  {
    title: "Uniswap V4 native",
    description:
      "Built on the PrivBatchHook and Uniswap V4. Perp positions live in a dedicated manager; execution flows through the same privacy-preserving hook.",
  },
];

export default function Home() {
  const { isAuthenticated, isLoading, error } = useAuth();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Ambient gradient */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
      >
        <div
          className="absolute -top-[40%] right-0 h-[80%] w-[70%] opacity-30"
          style={{
            background:
              "radial-gradient(ellipse at 70% 20%, rgba(120, 140, 180, 0.15) 0%, transparent 55%)",
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-[50%] opacity-20"
          style={{
            background:
              "radial-gradient(ellipse at 50% 100%, rgba(80, 100, 140, 0.08) 0%, transparent 60%)",
          }}
        />
        {/* Network-style lines */}
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.06]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="grid"
              width="60"
              height="60"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 60 0 L 0 0 0 60"
                fill="none"
                stroke="white"
                strokeWidth="0.5"
              />
            </pattern>
            {/* Faint grey box grid for content sections */}
            <pattern
              id="sectionGrid"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 32 0 L 0 0 0 32"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        {/* Vertical light streaks */}
        <div className="absolute inset-0 overflow-hidden">
          {[15, 30, 45, 60, 78].map((left) => (
            <div
              key={left}
              className="absolute top-0 h-full w-px opacity-[0.04]"
              style={{
                left: `${left}%`,
                background:
                  "linear-gradient(to bottom, transparent, rgba(255,255,255,0.6) 20%, transparent 80%)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0a0a0a]/90 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="text-xl font-extrabold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne), sans-serif" }}
            >
              ZKPerps
            </Link>
            <nav className="hidden items-center gap-8 md:flex">
              <Link
                href="/"
                className="text-sm text-white/80 transition-colors hover:text-white"
              >
                Home
              </Link>
              <Link
                href="/trade"
                className="text-sm text-white/80 transition-colors hover:text-white"
              >
                Trade
              </Link>
              <a
                href="#features"
                className="text-sm text-white/80 transition-colors hover:text-white"
              >
                Features
              </a>
            </nav>
            <div className="flex items-center gap-3">
              {error && (
                <span className="text-xs text-amber-400" title={error}>
                  Auth error
                </span>
              )}
              {isAuthenticated ? (
                <>
                  <Link
                    href="/trade"
                    className="inline-flex h-9 items-center justify-center border border-white/20 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 md:hidden"
                    style={{ borderRadius: 0 }}
                  >
                    Trade
                  </Link>
                  <Link
                    href="/trade"
                    className="hidden h-9 items-center justify-center bg-white px-4 text-sm font-semibold text-[#0a0a0a] transition-colors hover:bg-white/90 md:inline-flex"
                    style={{ borderRadius: 0 }}
                  >
                    Open App
                  </Link>
                  <UserProfile />
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="hidden text-sm text-white/70 sm:inline">
                    Create Account
                  </span>
                  <LoginButton variant="sharp" size="sm" />
                </div>
              )}
            </div>
          </div>
        </header>

        <main>
          {/* Hero — full viewport height, sphere centered behind content */}
          <section className="relative flex min-h-screen flex-col">
            {/* Sphere: full-bleed, centered in hero */}
            <div className="absolute inset-0 z-0">
              <SentientSphere />
            </div>

            {/* Content overlay */}
            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-16 sm:px-6">
              <div className="mx-auto max-w-4xl text-center">
                {/* Capsule above headline */}
                <div
                  className="inline-flex items-center gap-2 border border-white/15 bg-[#0a0a0a]/80 px-4 py-2 text-sm text-white/90 backdrop-blur-sm"
                  style={{ borderRadius: 0 }}
                >
                  <span>Private perpetuals · Zero-knowledge execution</span>
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>

                <h1 className="mt-8 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
                  One-click for
                  <br />
                  <span
                    className="bg-gradient-to-r from-white via-white/95 to-white/80 bg-clip-text text-transparent"
                    style={{ backgroundSize: "200% auto" }}
                  >
                    Private Perpetuals
                  </span>
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/60 sm:text-xl">
                  Dive into private perpetuals, where zero-knowledge proofs meet
                  batch execution on Uniswap V4. Your orders stay hidden — only
                  aggregate flow hits the chain.
                </p>

                <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                  {isAuthenticated ? (
                    <Link
                      href="/trade"
                      className="inline-flex h-12 items-center justify-center gap-2 bg-white px-8 text-base font-semibold text-[#0a0a0a] transition-colors hover:bg-white/90"
                      style={{ borderRadius: 0 }}
                    >
                      Open App
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </Link>
                  ) : (
                    <>
                      <Link
                        href="/trade"
                        className="inline-flex h-12 items-center justify-center gap-2 border border-white/30 bg-white px-8 text-base font-semibold text-[#0a0a0a] transition-colors hover:bg-white/95"
                        style={{ borderRadius: 0 }}
                      >
                        Open App
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </Link>
                      <Link
                        href="#features"
                        className="inline-flex h-12 items-center justify-center gap-2 border border-white/20 bg-transparent px-8 text-base font-semibold text-white transition-colors hover:bg-white/10"
                        style={{ borderRadius: 0 }}
                      >
                        Discover More
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Scroll indicator */}
            <div className="absolute bottom-8 left-4 z-10 flex items-center gap-2 text-xs text-white/50 sm:left-6">
              <span className="flex items-center gap-1">
                <svg
                  className="h-4 w-4 animate-bounce"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
                Scroll down
              </span>
              <span className="text-white/30">01/03</span>
            </div>
          </section>

          {/* What is ZK Perps */}
          <section
            id="about"
            className="relative border-t border-white/[0.06] px-4 py-20 sm:px-6 sm:py-24"
          >
            <div
              className="pointer-events-none absolute inset-0 z-0"
              aria-hidden
            >
              <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="url(#sectionGrid)" />
              </svg>
            </div>
            <div className="relative z-10 mx-auto max-w-4xl">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                What is ZK Perps?
              </h2>
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                <div
                  className="border border-white/10 bg-white/[0.02] p-6"
                  style={{ borderRadius: 0 }}
                >
                  <p className="leading-relaxed text-white/70">
                    A full-stack app for{" "}
                    <strong className="text-white">ETH/USD perpetuals</strong>.
                    You get a live chart, order panel with leverage and margin,
                    and positions — all backed by Uniswap V4 and a commit–reveal
                    hook that batches orders and verifies them with
                    zero-knowledge proofs.
                  </p>
                </div>
                <div
                  className="border border-white/10 bg-white/[0.02] p-6"
                  style={{ borderRadius: 0 }}
                >
                  <p className="leading-relaxed text-white/70">
                    You <strong className="text-white">don't sign every tx</strong>
                    . Sign in with email; the backend holds an authorization key
                    and submits commits and reveals for you. The same
                    infrastructure supports autonomous agents that run private
                    batched swaps.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Features */}
          <section
            id="features"
            className="relative border-t border-white/[0.06] px-4 py-20 sm:px-6 sm:py-24"
          >
            <div
              className="pointer-events-none absolute inset-0 z-0"
              aria-hidden
            >
              <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="url(#sectionGrid)" />
              </svg>
            </div>
            <div className="relative z-10 mx-auto max-w-5xl">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Features
              </h2>
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((feature, i) => (
                  <div
                    key={feature.title}
                    className="border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-white/20"
                    style={{ borderRadius: 0 }}
                  >
                    <span className="text-xs font-medium tabular-nums text-white/50">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-2 text-lg font-semibold text-white">
                      {feature.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/60">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="relative border-t border-white/[0.06] px-4 py-20 sm:px-6 sm:py-24">
            <div
              className="pointer-events-none absolute inset-0 z-0"
              aria-hidden
            >
              <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="url(#sectionGrid)" />
              </svg>
            </div>
            <div
              className="relative z-10 mx-auto max-w-3xl border border-white/10 bg-white/[0.02] p-10 text-center sm:p-14"
              style={{ borderRadius: 0 }}
            >
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Ready to trade?
              </h2>
              <p className="mt-3 text-white/60">
                Sign in with your email and open long or short on ETH/USD with
                leverage — no wallet popups, just commit, reveal, and batch.
              </p>
              <div className="mt-8">
                {isAuthenticated ? (
                  <Link
                    href="/trade"
                    className="inline-flex h-12 items-center justify-center gap-2 bg-white px-8 text-base font-semibold text-[#0a0a0a] transition-colors hover:bg-white/90"
                    style={{ borderRadius: 0 }}
                  >
                    Go to trading
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </Link>
                ) : (
                  <LoginButton variant="sharp" />
                )}
              </div>
            </div>
          </section>

          {/* Footer + partners */}
          <footer className="border-t border-white/[0.06] px-4 py-12 sm:px-6">
            <div className="mx-auto max-w-6xl">
              <p className="mb-8 text-center text-xs uppercase tracking-widest text-white/40">
                Built for Uniswap V4 · Privy · Zero-knowledge proofs
              </p>
              <div className="flex flex-col items-center justify-between gap-6 border-t border-white/[0.06] pt-8 sm:flex-row">
                <span className="text-sm text-white/50">
                  ZK Perps — private perpetuals on Uniswap V4
                </span>
                <div className="flex gap-8">
                  <Link
                    href="/"
                    className="text-sm text-white/50 transition-colors hover:text-white/80"
                  >
                    Home
                  </Link>
                  <Link
                    href="/trade"
                    className="text-sm text-white/50 transition-colors hover:text-white/80"
                  >
                    Trade
                  </Link>
                  <a
                    href="#features"
                    className="text-sm text-white/50 transition-colors hover:text-white/80"
                  >
                    Features
                  </a>
                </div>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
