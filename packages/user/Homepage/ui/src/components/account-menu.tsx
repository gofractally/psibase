import {
    BookUser,
    LogOut,
    Monitor,
    Moon,
    Sparkles,
    Store,
    Sun,
    UserPlus,
    UserRound,
    Users,
    Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAccountMarketplaceVisibility } from "@/apps/accounts-marketplace/hooks/use-account-marketplace-visibility";
import { ACCOUNT_MARKETPLACE_PATH } from "@/apps/accounts-marketplace/route";
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
import { toast } from "@shared/shadcn/ui/sonner";

/** Avatar menu at the right of the top bar. Logged out, it only offers the theme. */
export const AccountMenu = () => {
    const { data: user } = useCurrentUser();
    const generateInvite = useGenerateInvite();
    const [showInvite, setShowInvite] = useState(false);

    return (
        <>
            <Dialog open={showInvite} onOpenChange={setShowInvite}>
                <GenerateInviteDialogContent generateInvite={generateInvite} />
            </Dialog>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label="Account menu"
                        className="focus-visible:ring-ring/50 data-[state=open]:ring-ring/40 shrink-0 rounded-full outline-none transition-shadow focus-visible:ring-2 data-[state=open]:ring-2"
                    >
                        {user ? (
                            <Avatar
                                account={user}
                                className="size-8 border-0 shadow-none"
                                alt=""
                            />
                        ) : (
                            <span className="bg-muted/60 text-muted-foreground flex size-8 items-center justify-center rounded-full border">
                                <UserRound className="size-4" />
                            </span>
                        )}
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                    {user && (
                        <AccountItems
                            user={user}
                            onInvite={() => {
                                generateInvite.mutate();
                                setShowInvite(true);
                            }}
                        />
                    )}
                    <ThemeSubmenu />
                    {user && <SessionItems />}
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};

const AccountItems = ({
    user,
    onInvite,
}: {
    user: string;
    onInvite: () => void;
}) => {
    const { data: profile } = useProfile(user, true);
    const displayName = profile?.profile?.displayName?.trim();
    const { open: openAccount } = useAccountSheet();
    const marketplace = useAccountMarketplaceVisibility();

    return (
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
                <DropdownMenuItem onClick={() => openAccount("profile")}>
                    <UserRound />
                    Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openAccount("credits")}>
                    <Zap />
                    Usage credits
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openAccount("preferences")}>
                    <Sparkles />
                    Preferences
                </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                    <Link to="/contacts">
                        <BookUser />
                        Contacts
                    </Link>
                </DropdownMenuItem>
                {marketplace.visible && (
                    <DropdownMenuItem asChild>
                        <Link to={`/${ACCOUNT_MARKETPLACE_PATH}`}>
                            <Store />
                            Account Marketplace
                        </Link>
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onInvite}>
                    <UserPlus />
                    Invite a friend
                </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
        </>
    );
};

const ThemeSubmenu = () => {
    const { theme, setTheme } = useTheme();
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <Moon className="text-muted-foreground mr-2 size-4" />
                Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(v) => setTheme(v as typeof theme)}
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
    );
};

const SessionItems = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { mutateAsync: logout } = useLogout();
    const { mutateAsync: login } = useConnectAccount({
        onError: (error) => toast.error(error.message),
    });

    return (
        <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
                onClick={() =>
                    login({
                        enabled: true,
                        returnPath: `${location.pathname}${location.search}${location.hash}`,
                    })
                }
            >
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
    );
};
