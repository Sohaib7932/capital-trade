import {
  ArrowLeftRight,
  LayoutGrid,
  Network,
  PieChart,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/ibs", label: "IBs", icon: Network },
  { href: "/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/profit-split", label: "Profit Split", icon: PieChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function activeNavItem(pathname: string | null): NavItem | undefined {
  if (!pathname) return undefined;
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
