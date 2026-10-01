import { Bell, Coins, LogIn, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useConversations } from "@/apps/chainmail/hooks/use-conversations";
import { useUserTokenBalances } from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { AccountMenu } from "@/components/account-menu";
import { NotificationsSheet } from "@/components/notifications-sheet";

import { useNotifications } from "@/hooks/use-notifications";
import { formatCompact } from "@/lib/format";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

/** Right-hand cluster of the top bar: balance, chats, notifications, account. */
export const TopBarActions = () => {
    const { data: user, isPending } = useCurrentUser();

    if (isPending) {
        return <Skeleton className="size-8 rounded-full" />;
    }
    if (!user) {
        return (
            <div className="flex items-center gap-2">
                <LoginButton />
                <AccountMenu />
            </div>
        );
    }
    return (
        <div className="flex items-center gap-1 sm:gap-1.5">
            <BalancePill user={user} />
            <ChatsButton />
            <NotificationsButton />
            <AccountMenu />
        </div>
    );
};

const PILL =
    "bg-muted/60 hover:bg-muted focus-visible:ring-ring/50 rounded-full border outline-none transition-colors focus-visible:ring-2";
const ICON_PILL = `${PILL} relative flex size-8 items-center justify-center`;

const CountBadge = ({ count }: { count: number }) =>
    count > 0 ? (
        <span className="ring-background pointer-events-none absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[var(--brand)] px-1 text-center text-[10px] font-semibold tabular-nums leading-4 text-[var(--brand-foreground)] ring-2">
            {count > 99 ? "99+" : count}
        </span>
    ) : null;

const BalancePill = ({ user }: { user: string }) => {
    const { data: systemToken, isPending: tokenPending } = useSystemToken();
    const { data: balances, isPending: balancesPending } =
        useUserTokenBalances(user);
    const held = systemToken
        ? balances?.find((t) => t.id === Number(systemToken.id))
        : undefined;
    const loading = tokenPending || (!!systemToken && balancesPending);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Link
                    to="/tokens"
                    className={`${PILL} flex h-8 items-center gap-1.5 pl-1 pr-3 text-sm`}
                >
                    <span className="flex size-6 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-foreground)]">
                        <Coins className="size-3.5" />
                    </span>
                    {loading ? (
                        <Skeleton className="h-4 w-12" />
                    ) : systemToken ? (
                        <>
                            <span className="font-semibold tabular-nums">
                                {formatCompact(held?.balance?.amount ?? 0)}
                            </span>
                            <span className="text-muted-foreground hidden font-mono text-[11px] sm:inline">
                                {systemToken.symbol}
                            </span>
                        </>
                    ) : (
                        <span className="font-medium">Wallet</span>
                    )}
                </Link>
            </TooltipTrigger>
            <TooltipContent>Open your wallet</TooltipContent>
        </Tooltip>
    );
};

const ChatsButton = () => {
    const { unreadTotal } = useConversations();
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Link
                    to="/chainmail"
                    className={ICON_PILL}
                    aria-label={
                        unreadTotal ? `Chats, ${unreadTotal} unread` : "Chats"
                    }
                >
                    <MessageCircle className="size-4" />
                    <CountBadge count={unreadTotal} />
                </Link>
            </TooltipTrigger>
            <TooltipContent>Chats</TooltipContent>
        </Tooltip>
    );
};

const NotificationsButton = () => {
    const [open, setOpen] = useState(false);
    const { count } = useNotifications();
    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className={ICON_PILL}
                        onClick={() => setOpen(true)}
                        aria-label={
                            count
                                ? `Notifications, ${count} new`
                                : "Notifications"
                        }
                    >
                        <Bell className="size-4" />
                        <CountBadge count={count} />
                    </button>
                </TooltipTrigger>
                <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
            <NotificationsSheet open={open} onOpenChange={setOpen} />
        </>
    );
};

const LoginButton = () => {
    const location = useLocation();
    const { mutate: login, isPending } = useConnectAccount({
        onError: (error) => toast.error(error.message),
    });
    return (
        <Button
            size="sm"
            className="h-8"
            disabled={isPending}
            onClick={() =>
                login({
                    enabled: true,
                    returnPath: `${location.pathname}${location.search}${location.hash}`,
                })
            }
        >
            <LogIn className="size-3.5" />
            Log in
        </Button>
    );
};
