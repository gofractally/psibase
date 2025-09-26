import {
    Contact,
    LucideIcon,
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

interface MenuItem {
    groupLabel: string;
    path: string;
    menus: {
        title: string;
        icon: LucideIcon,
        path: string;
    }[],
    button?: {
        label: string;
        onClick: () => void;
    }
}

const browseMenu: MenuItem[] = [
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



export const staticFractalMenus: MenuItem[] = [
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

] as const;

export function NavMain() {
    const location = useLocation();

    const fractalName = useCurrentFractal();


    const fractalMenus = [
        ...staticFractalMenus,
    ]


    const isBrowse = !location.pathname.startsWith("/fractal");

    const menus = isBrowse ? browseMenu : fractalMenus;

    return (
        <>
            {menus.map((item) => (
                <SidebarGroup>
                    <SidebarGroupLabel>{item.groupLabel}</SidebarGroupLabel>
                    <SidebarMenu>
                        {item.menus?.map((menu) => (
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
                        {item.button && <button onClick={() => {

                        }} className="border text-sm rounded-sm border-dashed border-muted-foreground/50 py-3 hover:border-primary">Create Guild</button>}

                    </SidebarMenu>
                </SidebarGroup>
            ))}
        </>
    );
}
