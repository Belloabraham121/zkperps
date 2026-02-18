/**
 * Prep: Navbar section box.
 * Assign: Logo, Trade/Leaderboard nav, Deposit, Trading account summary, Notifications, Profile.
 */
export function NavbarBox() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-amber-500/50 bg-amber-950/40 px-4">
      <span className="text-sm font-medium text-amber-200/90">[Navbar]</span>
      <span className="text-xs text-amber-400/70">Logo · Trade · Leaderboard · Deposit · Account · Notifications</span>
    </header>
  );
}
