import Link from "next/link";
import { LogoWordmark } from "@/components/Logo";

const NAV_ITEMS = [
  { href: "/", label: "Home", match: "home" },
  { href: "/methodology", label: "Methodology", match: "methodology" },
] as const;

export function SiteHeader({ current }: { current: "home" | "methodology" | "fighter" }) {
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
        </nav>
      </div>
    </header>
  );
}
