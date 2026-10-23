"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { getGoldSpot } from "@/lib/api";
import { formatPercent, formatPrice, signOf } from "@/lib/calculations";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { useSignOut } from "./use-sign-out";
import { activeNavItem, NAV_ITEMS } from "./nav-items";

interface SidebarProps {
  /** Called after a link is clicked (closes the mobile drawer). */
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const signOut = useSignOut();
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" onClick={onNavigate} aria-label="CapitalTrade dashboard">
          <Logo />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-4">
        <p className="eyebrow mb-2 px-3">Navigation</p>
        {/* usePathname can suspend on dynamic routes; fall back to an unhighlighted menu. */}
        <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
          <ActiveNavList onNavigate={onNavigate} />
        </Suspense>
      </nav>

      <div className="space-y-2 border-t p-3">
        <GoldSpotWidget />
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            void signOut();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}

function ActiveNavList({ onNavigate }: SidebarProps) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavList({ pathname, onNavigate }: SidebarProps & { pathname: string | null }) {
  const active = activeNavItem(pathname);
  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const isActive = item === active;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gold-soft font-semibold text-gold-ink"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function GoldSpotWidget() {
  const { data } = useAsync(getGoldSpot, []);
  const sign = data ? signOf(data.changePct) : 0;
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-[10px]">Gold spot (XAU/USD)</p>
        <span className="size-1.5 rounded-full bg-profit" aria-hidden />
      </div>
      {data ? (
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="num text-sm font-bold text-gold-ink">${formatPrice(data.price)}</span>
          <span className={cn("num text-xs font-semibold", sign >= 0 ? "text-profit-ink" : "text-loss")}>
            {formatPercent(data.changePct, { signed: true, places: 2 })}
          </span>
        </div>
      ) : (
        <Skeleton className="mt-1.5 h-4 w-full" />
      )}
      <p className="mt-0.5 text-[10px] text-muted-foreground">Last MT5 fill</p>
    </div>
  );
}
