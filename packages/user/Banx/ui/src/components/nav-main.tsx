import {
    ArrowLeftRight,
    Banknote,
    Coins,
    Contact,
    GitBranch,
    Inbox,
    ScrollText,
    UserPlus,
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
    { to: "/accounts", label: "Accounts", icon: ScrollText },
    { to: "/path-pay", label: "Transfer", icon: GitBranch },
    { to: "/requests", label: "Requests", icon: Inbox },
    { to: "/payees", label: "Payees", icon: Contact },
    { to: "/invites", label: "Invites", icon: UserPlus },
    { to: "/cash", label: "Cash", icon: Banknote },
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
