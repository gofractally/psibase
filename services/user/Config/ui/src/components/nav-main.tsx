import { FolderUp, Pickaxe, Settings, Upload } from "lucide-react";
import { NavLink } from "react-router-dom";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";

import { cn } from "@/lib/utils";

export const appMenus = [
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
        icon: Upload,
        path: "packages",
    },
    {
        title: "Pending Transactions",
        icon: Settings,
        path: "pending-transactions",
    },
];

export function NavMain() {
    return (
        <SidebarGroup>
            <SidebarGroupLabel>Network configuration</SidebarGroupLabel>
            <SidebarMenu>
                {appMenus.map((item) => (
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
