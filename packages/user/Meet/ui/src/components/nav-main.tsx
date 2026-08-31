import { useQuery } from "@tanstack/react-query";
import { Lock, Video } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { getMeetingsForAccount } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
} from "@shared/shadcn/ui/sidebar";

export function NavMain() {
    const location = useLocation();
    const { data: currentUser } = useCurrentUser();
    const loggedIn = typeof currentUser === "string";
    const isHomeActive =
        location.pathname === "/" || location.pathname === "";

    const myMeetings = useQuery({
        queryKey: ["meet", "mine", currentUser],
        enabled: loggedIn,
        queryFn: () => getMeetingsForAccount(currentUser as string),
    });

    const rooms = myMeetings.data ?? [];

    return (
        <>
            <SidebarGroup>
                <SidebarGroupLabel>Meet</SidebarGroupLabel>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            asChild
                            isActive={isHomeActive}
                            tooltip="Rooms"
                        >
                            <NavLink to="/" end>
                                <Video />
                                <span>Rooms</span>
                            </NavLink>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarGroup>

            {loggedIn ? (
                <SidebarGroup>
                    <SidebarGroupLabel>My rooms</SidebarGroupLabel>
                    <SidebarMenu>
                        {myMeetings.isPending ? (
                            <SidebarMenuItem>
                                <SidebarMenuSkeleton showIcon />
                            </SidebarMenuItem>
                        ) : rooms.length === 0 ? (
                            <SidebarMenuItem>
                                <span className="text-muted-foreground px-2 text-xs">
                                    No private rooms yet
                                </span>
                            </SidebarMenuItem>
                        ) : (
                            rooms.map((row) => {
                                const to = `/private/${row.meetingId}`;
                                const isActive =
                                    location.pathname === to ||
                                    location.pathname === `${to}/`;
                                return (
                                    <SidebarMenuItem key={row.meetingId}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            tooltip={row.meetingId}
                                        >
                                            <NavLink to={to}>
                                                <Lock />
                                                <span className="truncate">
                                                    {row.meetingId}
                                                </span>
                                            </NavLink>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })
                        )}
                    </SidebarMenu>
                </SidebarGroup>
            ) : null}
        </>
    );
}
