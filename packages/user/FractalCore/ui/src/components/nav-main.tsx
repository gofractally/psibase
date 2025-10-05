import {
    Calendar,
    CalendarArrowDownIcon,
    Contact,
    LucideIcon,
    PlusCircleIcon,
    SettingsIcon,
    Users,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { cn } from "@shared/lib/utils";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";
import { useGuildSlug } from "@/hooks/use-guild-id";

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


export const staticFractalMenus: MenuItem[] = [
    {
        groupLabel: "Fractal",
        path: "",
        menus: [
            {
                title: "Membership",
                icon: Contact,
                path: "membership",
            },
            {
                title: "Members",
                icon: Users,
                path: "members",
            },

        ],
    },
];


export function NavMain() {
    const location = useLocation();

    const guildSlug = useGuildSlug();

    const guildMenus: MenuItem[] = [
        {
            groupLabel: "Membership",
            path: `/guild/${guildSlug}`,
            menus: [
                {
                    title: "My membership",
                    icon: Contact,
                    path: '',
                },
                {
                    title: "Members",
                    icon: Users,
                    path: 'members'
                },
                {
                    title: "Applications",
                    icon: PlusCircleIcon,
                    path: "applications"
                }
            ],
        },
        {
            groupLabel: "Evaluations",
            path: `/guild/${guildSlug}`,
            menus: [
                {
                    title: "Active & Upcoming",
                    icon: Calendar,
                    path: "evaluations"
                },
                {
                    title: "Completed",
                    icon: CalendarArrowDownIcon,
                    path: "evaluations/completed"
                }
            ]
        },
        {
            groupLabel: "Governance",
            path: `/guild/${guildSlug}`,
            menus: [
                {
                    title: "Settings",
                    icon: SettingsIcon,
                    path: 'settings',
                },

            ],
        },
    ];

    const isBrowse = !location.pathname.startsWith("/guild");

    const menus = isBrowse ? staticFractalMenus : guildMenus;

    return (
        <>
            {menus.map((item) => (
                <SidebarGroup>
                    <SidebarGroupLabel>{item.groupLabel}</SidebarGroupLabel>
                    <SidebarMenu>
                        {item.menus?.map((menu) => (
                            <NavLink
                                to={
                                    `${item.path}/${menu.path}`
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
