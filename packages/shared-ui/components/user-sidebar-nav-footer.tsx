import type { ReactNode } from "react";

import { ChevronsUpDown, UserRound } from "lucide-react";

import { AccountMenuItems } from "@shared/components/account-menu";
import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@shared/shadcn/ui/sidebar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    onProfile?: () => void;
    /** The app's own menu items. */
    children?: ReactNode;
}

/**
 * The account menu for the foot of an app's sidebar. It opens the same menu
 * as `AccountMenu` does from a top bar; only the trigger differs.
 */
export function UserSidebarNavFooter({ onProfile, children }: Props = {}) {
    const { isMobile } = useSidebar();
    const { data: user, isPending: isPendingUser } = useCurrentUser();
    const { data: profile } = useProfile(user);
    const displayName = profile?.profile?.displayName?.trim();

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            aria-label="Account menu"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            {isPendingUser ? (
                                <Skeleton className="size-8 rounded-full" />
                            ) : user ? (
                                <Avatar account={user} className="h-8 w-8" />
                            ) : (
                                <span className="bg-muted/60 text-muted-foreground flex size-8 items-center justify-center rounded-full border">
                                    <UserRound className="size-4" />
                                </span>
                            )}
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                {isPendingUser ? (
                                    <Skeleton className="h-4 w-32" />
                                ) : (
                                    <>
                                        <span className="truncate font-medium">
                                            {user
                                                ? displayName || user
                                                : "Guest"}
                                        </span>
                                        {user && displayName && (
                                            <span className="text-muted-foreground truncate font-mono text-[11px]">
                                                @{user}
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                            <ChevronsUpDown className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] min-w-60 rounded-lg"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <AccountMenuItems onProfile={onProfile}>
                            {children}
                        </AccountMenuItems>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
