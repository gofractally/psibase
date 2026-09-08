import {
    Activity,
    ArrowLeftRight,
    Boxes,
    Globe,
    LayoutGrid,
    Radio,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { formatNumber } from "@/lib/format";
import { useChainStats, useHead } from "@/store/use-live-chain";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

const items = [
    { to: "/", label: "Dashboard", icon: Activity, end: true },
    { to: "/blocks", label: "Blocks", icon: Boxes },
    { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    { to: "/producers", label: "Producers", icon: Radio },
    { to: "/services", label: "Services", icon: LayoutGrid },
    { to: "/network", label: "Network", icon: Globe },
];

export function NavMain() {
    const location = useLocation();
    const head = useHead();
    const stats = useChainStats();

    const badgeFor = (to: string) => {
        if (to === "/blocks" && head) return `#${formatNumber(head.blockNum)}`;
        if (to === "/producers" && stats.producers.length)
            return String(stats.producers.length);
        return null;
    };

    return (
        <SidebarGroup>
            <SidebarGroupLabel>Explore</SidebarGroupLabel>
            <SidebarMenu>
                {items.map((item) => {
                    const active = item.end
                        ? location.pathname === item.to
                        : location.pathname.startsWith(item.to);
                    const badge = badgeFor(item.to);
                    return (
                        <SidebarMenuItem key={item.to}>
                            <SidebarMenuButton
                                asChild
                                isActive={active}
                                tooltip={item.label}
                            >
                                <NavLink to={item.to} end={item.end}>
                                    <item.icon />
                                    <span>{item.label}</span>
                                </NavLink>
                            </SidebarMenuButton>
                            {badge && (
                                <SidebarMenuBadge className="font-mono text-[10px] tabular-nums opacity-70">
                                    {badge}
                                </SidebarMenuBadge>
                            )}
                        </SidebarMenuItem>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
