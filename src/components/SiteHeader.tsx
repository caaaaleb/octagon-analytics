import Link from "next/link";
import { LogoWordmark } from "@/components/Logo";
import { createClient } from "@/utils/supabase/server";
import { logout } from "@/lib/auth-actions";

const NAV_ITEMS = [
  { href: "/", label: "Home", match: "home" },
  { href: "/methodology", label: "Methodology", match: "methodology" },
] as const;

export async function SiteHeader({
  current,
}: {
  current: "home" | "methodology" | "fighter" | "picks" | "login" | "signup";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight transition-opacity hover:opacity-80">
          <LogoWordmark />
        </Link>
        <nav className="flex items-center gap-5 text-xs font-medium uppercase tracking-wide">
          {NAV_ITEMS.map((item) => {
            const isActive = item.match === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`transition-colors ${isActive ? "text-accent" : "text-muted hover:text-accent"}`}
              >
                {item.label}
              </Link>
            );
          })}
          {current === "fighter" && <span className="text-muted">Fighter</span>}

          {user ? (
            <>
              <Link
                href="/picks"
                aria-current={current === "picks" ? "page" : undefined}
                className={`transition-colors ${current === "picks" ? "text-accent" : "text-muted hover:text-accent"}`}
              >
                Picks
              </Link>
              <span className="hidden text-muted sm:inline" title={user.email}>
                {user.email}
              </span>
              <form action={logout}>
                <button type="submit" className="text-muted transition-colors hover:text-accent">
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              aria-current={current === "login" ? "page" : undefined}
              className={`transition-colors ${current === "login" ? "text-accent" : "text-muted hover:text-accent"}`}
            >
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
