import {
    CalendarCheck,
    CalendarClock,
    Contact,
    Search,
    Users,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { useCurrentFractal } from "@/hooks/use-current-fractal";

import { cn } from "@shared/lib/utils";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

const browseMenu = [
    {
        groupLabel: "Global",
        path: "",
        menus: [
            {
                title: "Browse",
                icon: Search,
                path: "",
            },
        ],
    },
];

export const fractalMenus = [
    {
        groupLabel: "Membership",
        path: "membership",
        menus: [
            {
                title: "My membership",
                icon: Contact,
                path: "",
            },
            {
                title: "All members",
                icon: Users,
                path: "members",
            },
        ],
    },
    {
        groupLabel: "Evaluations",
        path: "evaluations",
        menus: [
            {
                title: "Active & upcoming",
                icon: CalendarClock,
                path: "",
            },
            {
                title: "Completed",
                icon: CalendarCheck,
                path: "completed",
            },
        ],
    },
] as const;

export function NavMain() {
    const location = useLocation();

    const fractalName = useCurrentFractal();

    const isBrowse = !location.pathname.startsWith("/fractal");

    const menus = isBrowse ? browseMenu : fractalMenus;

    return (
        <>
            {menus.map((item) => (
                <SidebarGroup>
                    <SidebarGroupLabel>{item.groupLabel}</SidebarGroupLabel>
                    <SidebarMenu>
                        {item.menus.map((menu) => (
                            <NavLink
                                to={
                                    isBrowse
                                        ? item.path
                                        : `/fractal/${fractalName}/${item.path}/${menu.path}`
                                }
                                end
                            >
                                {({ isActive }) => (
                                    <SidebarMenuItem
                                        className={cn({
                                            "bg-muted/50 rounded-sm font-semibold":
                                                isActive,
                                        })}
                                    >
                                        <SidebarMenuButton tooltip={menu.title}>
                                            {menu.icon && <menu.icon />}
                                            <span>{menu.title}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )}
                            </NavLink>
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
            ))}
        </>
    );
}
