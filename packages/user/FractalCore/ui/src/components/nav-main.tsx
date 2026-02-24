import {
    Calendar,
    ChevronRight,
    Contact,
    Gavel,
    Home,
    Landmark,
    LucideIcon,
    Scale,
    Users,
    UsersRound,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@shared/shadcn/ui/collapsible";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubItem,
} from "@shared/shadcn/ui/sidebar";

export interface MenuGroup {
    groupLabel: string;
    items: MenuItem[];
}

export interface MenuItem {
    title: string;
    icon?: LucideIcon;
    path?: string;
    subItems?: SubMenuItem[];
}

export interface SubMenuItem {
    title: string;
    icon: LucideIcon;
    path: string;
}

export function getMenuGroups(
    memberships?: Array<{ guild: { account: string; displayName: string } }>,
): MenuGroup[] {
    const fractalGroup: MenuGroup = {
        groupLabel: "Fractal",
        items: [
            {
                title: "Overview",
                icon: Home,
                path: "/",
            },
            {
                title: "Guilds",
                icon: Landmark,
                path: "/guilds",
            },
            {
                title: "Members",
                icon: Users,
                path: "/members",
            },
            {
                title: "Governance",
                icon: Scale,
                subItems: [
                    {
                        title: "Legislative",
                        icon: Scale,
                        path: "/legislative",
                    },
                    {
                        title: "Judicial",
                        icon: Gavel,
                        path: "/judicial",
                    },
                ],
            },
        ],
    };

    const myGuildsGroup: MenuGroup = {
        groupLabel: "My Guilds",
        items:
            memberships?.map((membership) => ({
                title: membership.guild.displayName,
                subItems: [
                    {
                        title: "Overview",
                        icon: Home,
                        path: `/guild/${membership.guild.account}`,
                    },
                    {
                        title: "Membership",
                        icon: Contact,
                        path: `/guild/${membership.guild.account}/members`,
                    },
                    {
                        title: "Evaluations",
                        icon: Calendar,
                        path: `/guild/${membership.guild.account}/evaluations`,
                    },
                    {
                        title: "Leadership",
                        icon: UsersRound,
                        path: `/guild/${membership.guild.account}/leadership`,
                    },
                ],
            })) || [],
    };

    return [
        fractalGroup,
        ...(memberships && memberships.length > 0 ? [myGuildsGroup] : []),
    ];
}

export function NavMain() {
    const { data: currentUser } = useCurrentUser();
    const { data: memberships } = useGuildMembershipsOfUser(currentUser);

    const groups = getMenuGroups(memberships);

    const renderMenuItem = (item: MenuItem, basePath: string = "") => {
        const hasSubItems = item.subItems && item.subItems.length > 0;
        const itemPath = item.path ? `${basePath}${item.path}` : undefined;

        if (hasSubItems) {
            return (
                <Collapsible className="group/collapsible list-none">
                    <SidebarMenuItem key={item.title} className="list-none">
                        <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip={item.title}>
                                {item.icon && <item.icon />}
                                <span>{item.title}</span>
                                <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                            </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <SidebarMenuSub>
                                {item.subItems?.map((subItem) => (
                                    <SidebarMenuSubItem key={subItem.path}>
                                        <NavLink to={subItem.path} end>
                                            {({ isActive }) => (
                                                <SidebarMenuButton
                                                    tooltip={subItem.title}
                                                    isActive={isActive}
                                                >
                                                    {subItem.icon && (
                                                        <subItem.icon />
                                                    )}
                                                    <span>{subItem.title}</span>
                                                </SidebarMenuButton>
                                            )}
                                        </NavLink>
                                    </SidebarMenuSubItem>
                                ))}
                            </SidebarMenuSub>
                        </CollapsibleContent>
                    </SidebarMenuItem>
                </Collapsible>
            );
        }

        if (itemPath) {
            return (
                <NavLink key={item.title} to={itemPath} end>
                    {({ isActive }) => (
                        <SidebarMenuItem
                            className={cn({
                                "bg-muted/50 rounded-sm font-semibold":
                                    isActive,
                            })}
                        >
                            <SidebarMenuButton tooltip={item.title}>
                                {item.icon && <item.icon />}
                                <span>{item.title}</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )}
                </NavLink>
            );
        }

        return null;
    };

    return (
        <>
            {groups
                .filter((group) => group.items.length > 0)
                .map((group) => (
                    <SidebarGroup key={group.groupLabel}>
                        <SidebarGroupLabel>
                            {group.groupLabel}
                        </SidebarGroupLabel>
                        <SidebarMenu>
                            {group.items.map((item) => renderMenuItem(item))}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
        </>
    );
}
