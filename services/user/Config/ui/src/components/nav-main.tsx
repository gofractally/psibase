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

interface Menu {
    title: string;
    icon: any;
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
