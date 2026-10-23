"use client";

import { Bell, CalendarDays, ChevronDown, ChevronRight, LogOut, Menu, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncPill } from "@/components/shared/sync-pill";
import { formatMonth } from "@/lib/dates";
import { initials } from "@/lib/utils";
import { useApp } from "./app-context";
import { activeNavItem } from "./nav-items";
import { Sidebar } from "./sidebar";
import { useSignOut } from "./use-sign-out";

export function Topbar() {
  const { month, months, setMonth, openAddClient, settings, canEdit } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const signOut = useSignOut();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card/95 px-4 backdrop-blur sm:gap-3 sm:px-6 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMenuOpen(true)}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main menu</SheetDescription>
          <Sidebar onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <Suspense fallback={<Breadcrumb pathname={null} />}>
        <ActiveBreadcrumb />
      </Suspense>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 gap-2 px-3" disabled={!month} aria-label="Select month">
              <CalendarDays className="text-muted-foreground" aria-hidden />
              {month ? (
                <>
                  <span className="hidden sm:inline">{formatMonth(month)}</span>
                  <span className="sm:hidden">{formatMonth(month, { short: true })}</span>
                </>
              ) : (
                <Skeleton className="h-4 w-20" />
              )}
              <ChevronDown className="text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Reporting month</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={month ?? undefined} onValueChange={setMonth}>
              {months.map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  {formatMonth(m)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {settings ? (
          <Link href="/settings?tab=mt5" className="hidden rounded-full md:inline-flex" aria-label="MT5 sync status">
            <SyncPill health={settings.mt5.health} lastSyncAt={settings.mt5.lastSyncAt} />
          </Link>
        ) : null}

        {canEdit ? (
        <Button onClick={openAddClient} className="h-9 px-3 font-semibold" aria-label="Add client">
          <Plus aria-hidden />
          <span className="hidden sm:inline">Add Client</span>
        </Button>
        ) : null}

        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Notifications">
          <Bell />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-lg p-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label="Account menu"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-[#1c1a17] text-xs font-semibold text-gold">
                  {settings ? initials(settings.profile.name) : ""}
                </AvatarFallback>
              </Avatar>
              <span className="hidden leading-tight md:block">
                <span className="block text-sm font-semibold">{settings?.profile.name ?? " "}</span>
                <span className="block text-xs text-muted-foreground">{settings ? (settings.profile.role === "admin" ? "Admin" : "Viewer · read-only") : " "}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="truncate">{settings?.profile.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings aria-hidden /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function ActiveBreadcrumb() {
  return <Breadcrumb pathname={usePathname()} />;
}

function Breadcrumb({ pathname }: { pathname: string | null }) {
  const item = activeNavItem(pathname);
  const isDetail = Boolean(item && pathname && pathname !== item.href);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <li>CapitalTrade</li>
        {item ? (
          <>
            <ChevronRight className="size-3.5" aria-hidden />
            <li>
              {isDetail ? (
                <Link href={item.href} className="hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span className="font-semibold text-gold-ink" aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          </>
        ) : null}
        {isDetail ? (
          <>
            <ChevronRight className="size-3.5" aria-hidden />
            <li className="font-semibold text-gold-ink" aria-current="page">
              Details
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
