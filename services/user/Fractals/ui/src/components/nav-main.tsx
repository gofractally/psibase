import {
    CalendarCheck,
    CalendarClock,
    CalendarPlus2,
    Contact,
    Search,
    Users,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";

import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { cn } from "@/lib/utils";

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
                title: "Proposed",
                icon: CalendarPlus2,
                path: "proposed",
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
                                            "rounded-sm bg-muted/50 font-semibold":
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
