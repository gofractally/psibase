import { useChainStats, useHead } from "@/store/use-live-chain";
import {
    Activity,
    ArrowLeftRight,
    Boxes,
    Globe,
    LayoutGrid,
    Radio,
    UserRound,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { formatNumber } from "@/lib/format";

import { useCurrentUser } from "@shared/hooks/use-current-user";
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
    { to: "/providers", label: "Providers", icon: Radio },
    { to: "/services", label: "Services", icon: LayoutGrid },
    { to: "/network", label: "Network", icon: Globe },
];

export function NavMain() {
    const location = useLocation();
    const head = useHead();
    const stats = useChainStats();
    const { data: currentUser } = useCurrentUser();

    const badgeFor = (to: string) => {
        if (to === "/blocks" && head) return `#${formatNumber(head.blockNum)}`;
        if (to === "/providers" && stats.producers.length)
            return String(stats.producers.length);
        return null;
    };

    return (
        <>
            {currentUser && (
                <SidebarGroup>
                    <SidebarGroupLabel>You</SidebarGroupLabel>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                asChild
                                isActive={location.pathname === "/me"}
                                tooltip="My dashboard"
                            >
                                <NavLink to="/me">
                                    <UserRound />
                                    <span>My dashboard</span>
                                </NavLink>
                            </SidebarMenuButton>
                            <SidebarMenuBadge className="max-w-24 truncate font-mono text-[10px] opacity-70">
                                {currentUser}
                            </SidebarMenuBadge>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            )}
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
        </>
    );
}
