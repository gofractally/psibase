import { FolderUp, LifeBuoy, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { useAppMetadata } from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";

import { cn } from "@shared/lib/utils";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export const appMenus = [
    {
        title: "Settings",
        icon: Settings,
        path: "",
    },
    {
        title: "Upload",
        icon: FolderUp,
        path: "upload",
    },
    {
        title: "Support",
        icon: LifeBuoy,
        path: "support",
    },
    // {
    //   title: "Pending requests",
    //   icon: LayoutList,
    //   path: "pending-requests",
    // },
];

export function NavMain() {
    const location = useLocation();
    const appName = location.pathname.split("/")[2];

    const currentApp = useCurrentApp();
    const { data: app } = useAppMetadata(currentApp);

    return (
        <SidebarGroup>
            <SidebarGroupLabel>
                {app?.name ?? currentApp} config
            </SidebarGroupLabel>
            <SidebarMenu>
                {appMenus.map((item) => (
                    <NavLink
                        to={`/app/${appName}/${item.path}`}
                        key={item.path}
                        end
                    >
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
