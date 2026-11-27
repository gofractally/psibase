import type { ReactNode } from "react";

import {
    KeyRound,
    LogIn,
    LogOut,
    Monitor,
    Moon,
    Sun,
    UserRound,
    Users,
} from "lucide-react";

import { Avatar } from "@shared/components/avatar";
import { useTheme } from "@shared/components/theme-provider";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useLogout } from "@shared/hooks/use-logout";
import { useProfile } from "@shared/hooks/use-profile";
import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import { toast } from "@shared/shadcn/ui/sonner";

import {
    accountsAndKeysUrl,
    logOutUrl,
    profileUrl,
    switchAccountUrl,
} from "./links";

interface Props {
    /**
     * Opens the profile in place, for an app that has its own profile view.
     * Without it, Profile goes to the home app's editor.
     */
    onProfile?: () => void;
    /** Items of the app itself, shown between the account and the theme. */
    children?: ReactNode;
}

/**
 * The contents of the account menu, the same in every app:
 *
 *   who is signed in
 *   Profile · Accounts & keys
 *   (the app's own items)
 *   Theme
 *   Switch account · Log out            or, signed out:  Sign in
 *
 * Render it inside a DropdownMenuContent. `AccountMenu` (top bar) and
 * `UserSidebarNavFooter` (sidebar) are the two triggers that do.
 */
export const AccountMenuItems = ({ onProfile, children }: Props) => {
    const { data: user } = useCurrentUser();
    const { data: profile } = useProfile(user);
    const displayName = profile?.profile?.displayName?.trim();

    const { mutateAsync: logout } = useLogout();
    const { mutateAsync: connect } = useConnectAccount({
        onError: (error) => toast.error(error.message),
    });

    const returnPath = () =>
        `${window.location.pathname}${window.location.search}${window.location.hash}`;

    return (
        <>
            <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2.5 px-2 py-2">
                    {user ? (
                        <Avatar
                            account={user}
                            className="size-9 border-0 shadow-none"
                            alt=""
                        />
                    ) : (
                        <span className="bg-muted/60 text-muted-foreground flex size-9 items-center justify-center rounded-full border">
                            <UserRound className="size-4" />
                        </span>
                    )}
                    <div className="grid min-w-0 leading-tight">
                        <span className="truncate text-sm font-semibold">
                            {user ? displayName || user : "Guest"}
                        </span>
                        <span className="text-muted-foreground truncate font-mono text-[11px]">
                            {user ? `@${user}` : "No account chosen for this app"}
                        </span>
                    </div>
                </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {user && (
                <>
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={() =>
                                onProfile
                                    ? onProfile()
                                    : window.location.assign(profileUrl())
                            }
                        >
                            <UserRound />
                            Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                window.location.assign(accountsAndKeysUrl())
                            }
                        >
                            <KeyRound />
                            Accounts & keys
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                </>
            )}

            {children}

            <ThemeSubmenu />
            <DropdownMenuSeparator />

            {user ? (
                <>
                    <DropdownMenuItem
                        onClick={() =>
                            window.location.assign(switchAccountUrl())
                        }
                    >
                        <Users />
                        Switch account
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={async () => {
                            // The plugin forgets the account for this app;
                            // the sign-in app then brings the visitor back
                            // as a guest.
                            await logout().catch(() => undefined);
                            window.location.assign(logOutUrl());
                        }}
                    >
                        <LogOut />
                        Log out
                    </DropdownMenuItem>
                </>
            ) : (
                <DropdownMenuItem
                    onClick={() =>
                        connect({ enabled: true, returnPath: returnPath() })
                    }
                >
                    <LogIn />
                    Sign in or create an account
                </DropdownMenuItem>
            )}
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
