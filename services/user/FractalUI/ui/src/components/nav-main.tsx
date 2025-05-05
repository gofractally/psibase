import {
    CalendarCheck,
    CalendarClock,
    CalendarPlus2,
    Contact,
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

import { cn } from "@/lib/utils";

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
                path: "",
            },
        ],
    },
    {
        groupLabel: "Evaluations",
        path: "evaluations",
        menus: [
            {
                title: "Active &amp; upcoming",
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

    const fractalName = location.pathname.split("/")[2];

    return (
        <>
            {fractalMenus.map((item) => (
                <SidebarGroup>
                    <SidebarGroupLabel>{item.groupLabel}</SidebarGroupLabel>
                    <SidebarMenu>
                        {item.menus.map((menu) => (
                            <NavLink
                                to={`/fractal/${fractalName}/${item.path}/${menu.path}`}
                                end
                            >
                                {({ isActive }) => (
                                    <SidebarMenuItem
                                        className={cn({
                                            "rounded-sm bg-muted/50 ": isActive,
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
