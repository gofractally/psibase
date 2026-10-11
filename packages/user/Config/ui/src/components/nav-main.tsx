import {
    DollarSign,
    FolderUp,
    ListTodo,
    type LucideIcon,
    Package,
    Pickaxe,
    Server,
    Settings,
    Store,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { useSystemToken } from "@shared/hooks/use-system-token";
import { cn } from "@shared/lib/utils";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

interface Menu {
    title: string;
    icon: LucideIcon;
    path: string;
}

export const appMenus: Menu[] = [
    {
        title: "Block production",
        icon: Pickaxe,
        path: "block-production",
    },
    {
        title: "Branding",
        icon: FolderUp,
        path: "branding",
    },
    {
        title: "Packages",
        icon: Package,
        path: "packages",
    },
    {
        title: "Pending transactions",
        icon: ListTodo,
        path: "pending-transactions",
    },
    {
        title: "Resources",
        icon: Server,
        path: "resources",
    },
    {
        title: "Resource Pricing",
        icon: DollarSign,
        path: "resource-pricing",
    },
    {
        title: "Account Marketplace",
        icon: Store,
        path: "account-marketplace",
    },
    {
        title: "Settings",
        icon: Settings,
        path: "settings",
    },
];

export function NavMain() {
    const { data: systemToken } = useSystemToken();
    const menus =
        systemToken?.untransferable === true
            ? appMenus.filter((item) => item.path !== "account-marketplace")
            : appMenus;

    return (
        <SidebarGroup>
            <SidebarGroupLabel>Network configuration</SidebarGroupLabel>
            <SidebarMenu>
                {menus.map((item) => (
                    <NavLink to={`/${item.path}`}>
                        {({ isActive }) => (
                            <SidebarMenuItem
                                className={cn({
                                    "bg-muted/50 rounded-sm ": isActive,
                                })}
                            >
                                <SidebarMenuButton tooltip={item.title}>
                                    {item.icon && <item.icon />}
                                    <span>{item.title}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        )}
                    </NavLink>
                ))}
            </SidebarMenu>
        </SidebarGroup>
    );
}
