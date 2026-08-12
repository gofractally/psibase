import {
    ArrowLeftRight,
    Coins,
    GitBranch,
    Home,
    Landmark,
    ScrollText,
    Wallet,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

const items: {
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    end?: boolean;
}[] = [
    { to: "/obligations", label: "Accounts", icon: ScrollText },
    { to: "/", label: "Dashboard", icon: Home, end: true },
    { to: "/credit-lines", label: "Credit lines", icon: Landmark },
    { to: "/deposit", label: "Deposit", icon: Wallet },
    { to: "/path-pay", label: "Path pay", icon: GitBranch },
    { to: "/policies", label: "Policies", icon: ArrowLeftRight },
    { to: "/assets", label: "Assets", icon: Coins },
];

export function NavMain() {
    const location = useLocation();

    return (
        <SidebarGroup>
            <SidebarGroupLabel>Banx</SidebarGroupLabel>
            <SidebarMenu>
                {items.map(({ to, label, icon: Icon, end }) => {
                    const active = end
                        ? location.pathname === "/" || location.pathname === ""
                        : location.pathname.startsWith(to);
                    return (
                        <SidebarMenuItem key={to}>
                            <SidebarMenuButton
                                asChild
                                isActive={active}
                                tooltip={label}
                            >
                                <NavLink to={to} end={!!end}>
                                    <Icon />
                                    <span>{label}</span>
                                </NavLink>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
