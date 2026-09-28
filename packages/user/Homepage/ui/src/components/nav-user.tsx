import {
    ChevronsUpDown,
    LogIn,
    LogOut,
    Monitor,
    Moon,
    Sparkles,
    Sun,
    UserPlus,
    UserRound,
    Users,
    Zap,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { GenerateInviteDialogContent } from "@/apps/contacts/components/generate-invite-dialog";

import { useAccountSheet } from "@/hooks/use-account-sheet";
import { useGenerateInvite } from "@/hooks/use-generate-invite";

import { Avatar } from "@shared/components/avatar";
import { useTheme } from "@shared/components/theme-provider";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useLogout } from "@shared/hooks/use-logout";
import { useProfile } from "@shared/hooks/use-profile";
import { Dialog } from "@shared/shadcn/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@shared/shadcn/ui/sidebar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { toast } from "@shared/shadcn/ui/sonner";

export function NavUser() {
    const location = useLocation();
    const navigate = useNavigate();
    const { isMobile } = useSidebar();
    const { theme, setTheme } = useTheme();
    const { open: openAccount } = useAccountSheet();

    const { data: user, isPending: isPendingUser } = useCurrentUser();
    const { data: profile } = useProfile(user, true);
    const displayName = profile?.profile?.displayName?.trim();

    const { mutateAsync: logout } = useLogout();
    const { mutateAsync: login } = useConnectAccount({
        onError: (error) => toast.error(error.message),
    });
    const generateInvite = useGenerateInvite();
    const [showInvite, setShowInvite] = useState(false);

    const onLogin = () =>
        login({
            enabled: true,
            returnPath: `${location.pathname}${location.search}${location.hash}`,
        });

    return (
        <>
            <Dialog open={showInvite} onOpenChange={setShowInvite}>
                <GenerateInviteDialogContent generateInvite={generateInvite} />
            </Dialog>
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
                                    <Skeleton className="size-8 shrink-0 rounded-full" />
                                ) : user ? (
                                    <Avatar
                                        account={user}
                                        className="size-8 shrink-0 border-0 shadow-none"
                                        alt=""
                                    />
                                ) : (
                                    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border">
                                        <UserRound className="size-4" />
                                    </span>
                                )}
                                <div className="grid min-w-0 flex-1 text-left leading-tight">
                                    {isPendingUser ? (
                                        <Skeleton className="h-4 w-24" />
                                    ) : user ? (
                                        <>
                                            <span className="truncate text-sm font-medium">
                                                {displayName || user}
                                            </span>
                                            <span className="text-muted-foreground truncate font-mono text-[11px]">
                                                @{user}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="truncate text-sm">
                                            Not logged in
                                        </span>
                                    )}
                                </div>
                                <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
                            </SidebarMenuButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="w-[--radix-dropdown-menu-trigger-width] min-w-60 rounded-lg"
                            side={isMobile ? "bottom" : "right"}
                            align="end"
                            sideOffset={4}
                        >
                            {user && (
                                <>
                                    <DropdownMenuLabel className="p-0 font-normal">
                                        <div className="flex items-center gap-2.5 px-2 py-2">
                                            <Avatar
                                                account={user}
                                                className="size-9 border-0 shadow-none"
                                                alt=""
                                            />
                                            <div className="grid min-w-0 leading-tight">
                                                <span className="truncate text-sm font-semibold">
                                                    {displayName || user}
                                                </span>
                                                <span className="text-muted-foreground truncate font-mono text-[11px]">
                                                    @{user}
                                                </span>
                                            </div>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                openAccount("profile")
                                            }
                                        >
                                            <UserRound />
                                            Profile
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                openAccount("credits")
                                            }
                                        >
                                            <Zap />
                                            Usage credits
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                openAccount("preferences")
                                            }
                                        >
                                            <Sparkles />
                                            Preferences
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                generateInvite.mutate();
                                                setShowInvite(true);
                                            }}
                                        >
                                            <UserPlus />
                                            Invite a friend
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                    <DropdownMenuSeparator />
                                </>
                            )}
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <Moon className="text-muted-foreground mr-2 size-4" />
                                    Theme
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup
                                        value={theme}
                                        onValueChange={(v) =>
                                            setTheme(v as typeof theme)
                                        }
                                    >
                                        <DropdownMenuRadioItem value="light">
                                            <Sun />
                                            Light
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="dark">
                                            <Moon />
                                            Dark
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="system">
                                            <Monitor />
                                            System
                                        </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            {user ? (
                                <>
                                    <DropdownMenuItem onClick={onLogin}>
                                        <Users />
                                        Switch account
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={async () => {
                                            await logout();
                                            navigate("/");
                                        }}
                                    >
                                        <LogOut />
                                        Log out
                                    </DropdownMenuItem>
                                </>
                            ) : (
                                <DropdownMenuItem
                                    onClick={onLogin}
                                    disabled={isPendingUser}
                                >
                                    <LogIn />
                                    Log in
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </SidebarMenu>
        </>
    );
}
