import type { ReactNode } from "react";

import { UserRound } from "lucide-react";

import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";

import { AccountMenuItems } from "./account-menu-items";

interface Props {
    onProfile?: () => void;
    /** The app's own menu items. */
    children?: ReactNode;
}

/**
 * The account menu for the right end of an app's top bar: the signed-in
 * account's avatar, opening the standard menu. This is where a user looks to
 * see who they are, switch account, manage keys and log out.
 */
export const AccountMenu = ({ onProfile, children }: Props) => {
    const { data: user } = useCurrentUser();
    return (
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
                            className="border-border dark:border-border size-8 border shadow-none"
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
                <AccountMenuItems onProfile={onProfile}>
                    {children}
                </AccountMenuItems>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
