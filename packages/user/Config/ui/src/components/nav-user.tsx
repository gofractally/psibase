import { ChevronsUpDown, LogIn, LogOut, Moon, Sun, Users } from "lucide-react";

import { useLogout } from "@/hooks/useLogout";

import { Avatar } from "@shared/components/avatar";
import { useTheme } from "@shared/components/theme-provider";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@shared/shadcn/ui/sidebar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export function NavUser() {
    const { isMobile } = useSidebar();
    const { setTheme } = useTheme();

    const { data: user, isPending: isPendingUser } = useCurrentUser();
    const { data: profile } = useProfile(user);

    const { mutateAsync: logout } = useLogout();
    const { mutateAsync: login } = useConnectAccount();

    const onSwitchAccounts = async () => {
        await login();
    };

    const onLogout = async () => {
        await logout();
        window.location.replace("/");
    };

    const displayName = profile?.profile?.displayName;

    return (
        <SidebarMenu>
            <SidebarGroupLabel>Acting as</SidebarGroupLabel>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            {isPendingUser ? (
                                <Skeleton className="size-8 rounded-full" />
                            ) : (
                                <Avatar
                                    account={user || ""}
                                    className="h-8 w-8"
                                />
                            )}
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate ">
                                    {isPendingUser ? (
                                        <Skeleton className="h-4 w-32" />
                                    ) : !user ? (
                                        "Not logged in"
                                    ) : (
                                        (displayName ?? user)
                                    )}
                                </span>
                            </div>
                            <ChevronsUpDown className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="cursor-default select-none p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar
                                    account={user || ""}
                                    className="h-8 w-8"
                                />
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">
                                        {displayName ?? user ?? "Not logged in"}{" "}
                                        {displayName && (
                                            <span className="text-muted-foreground text-xs">
                                                {`(${user})`}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger className="[&_svg:not([class*='text-'])]:text-muted-foreground gap-2 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0">
                                    <Moon className="mr-2 h-4 w-4" />
                                    <span>Theme</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuItem
                                            onClick={() => setTheme("light")}
                                        >
                                            <Sun className="mr-2 h-4 w-4" />
                                            <span>Light</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => setTheme("dark")}
                                        >
                                            <Moon className="mr-2 h-4 w-4" />
                                            <span>Dark</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => setTheme("system")}
                                        >
                                            <Sun className="mr-2 h-4 w-4" />
                                            <span>System</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        {user ? (
                            <>
                                <DropdownMenuItem onClick={onSwitchAccounts}>
                                    <Users className="mr-2 h-4 w-4" />
                                    Switch account
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onLogout}>
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Log out
                                </DropdownMenuItem>
                            </>
                        ) : (
                            <DropdownMenuItem
                                onClick={() => login()}
                                disabled={isPendingUser}
                            >
                                <LogIn className="mr-2 h-4 w-4" />
                                Log in
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
