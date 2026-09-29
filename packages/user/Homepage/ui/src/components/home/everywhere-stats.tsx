import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { BookUser, Coins, MessageCircle, Zap } from "lucide-react";
import { Link } from "react-router-dom";

import { useConversations } from "@/apps/chainmail/hooks/use-conversations";
import { UsageMeter } from "@/apps/settings/components/usage-meter";
import {
    levelTone,
    useUsageCredits,
} from "@/apps/settings/hooks/use-usage-credits";
import { useUserTokenBalances } from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { FitValue } from "@/components/stat-card";

import { accountSheetHref } from "@/hooks/use-account-sheet";
import { formatCompact } from "@/lib/format";

import { useBranding } from "@shared/hooks/use-branding";
import { useContacts } from "@shared/hooks/use-contacts";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const Tile = ({
    to,
    label,
    icon: Icon,
    accent,
    value,
    sub,
    children,
}: {
    to: string;
    label: string;
    icon: LucideIcon;
    accent: string;
    value: ReactNode;
    sub: ReactNode;
    children?: ReactNode;
}) => (
    <Link
        to={to}
        className="bg-card/70 hover:bg-card group relative flex flex-col overflow-hidden rounded-xl border p-5 shadow-sm backdrop-blur transition-colors"
    >
        <span
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-20"
            style={{ backgroundColor: accent }}
        />
        <span className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                {label}
            </span>
            <Icon
                className="size-4 shrink-0 opacity-70"
                style={{ color: accent }}
            />
        </span>
        <FitValue className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
            {value}
        </FitValue>
        {children}
        <span className="text-muted-foreground mt-1 text-xs">{sub}</span>
    </Link>
);

/**
 * The shared things that follow the user into every app, each with a live
 * summary. This is the heart of "one account, every app".
 */
export const EverywhereStats = ({ user }: { user: string }) => {
    const { data: networkName } = useBranding();
    const { data: systemToken, isPending: tokenPending } = useSystemToken();
    const balances = useUserTokenBalances(user);
    const credits = useUsageCredits();
    const chats = useConversations();
    const { data: hasContacts } = useHasProfilesReadPermission({
        enabled: !!user,
    });
    const contacts = useContacts(user, { enabled: !!hasContacts });

    const held = systemToken
        ? balances.data?.find((t) => t.id === Number(systemToken.id))
        : undefined;
    const tokenCount = balances.data?.length ?? 0;
    const contactCount =
        contacts.data?.filter((c) => c.account !== user).length ?? 0;
    const unreadPeople = chats.conversations.filter((c) => c.unread).length;

    return (
        <section aria-labelledby="everywhere-heading">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2
                    id="everywhere-heading"
                    className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
                >
                    Goes with you into every app
                </h2>
                <p className="text-muted-foreground text-xs">
                    Apps on {networkName || "the network"} can use these (with
                    your permission), so you never start from scratch.
                </p>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Tile
                    to="/tokens"
                    label="Balance"
                    icon={Coins}
                    accent="var(--brand)"
                    value={
                        tokenPending || balances.isPending ? (
                            <Skeleton className="h-7 w-24" />
                        ) : systemToken ? (
                            <>
                                {formatCompact(held?.balance?.amount ?? 0)}{" "}
                                <span className="text-muted-foreground font-mono text-sm font-normal">
                                    {systemToken.symbol}
                                </span>
                            </>
                        ) : (
                            <>
                                {tokenCount}{" "}
                                <span className="text-muted-foreground text-sm font-normal">
                                    {tokenCount === 1 ? "token" : "tokens"}
                                </span>
                            </>
                        )
                    }
                    sub={
                        systemToken
                            ? `${tokenCount} ${tokenCount === 1 ? "token" : "tokens"} · spend in any app`
                            : "Spend them in any app"
                    }
                />
                <Tile
                    to={accountSheetHref("credits")}
                    label="Usage credits"
                    icon={Zap}
                    accent={
                        credits.enabled
                            ? levelTone(credits.level)
                            : "oklch(0.696 0.17 162.48)"
                    }
                    value={
                        credits.isLoading ? (
                            <Skeleton className="h-7 w-16" />
                        ) : credits.enabled ? (
                            `${Math.round(credits.level)}%`
                        ) : (
                            "Free"
                        )
                    }
                    sub={
                        credits.enabled
                            ? credits.level <= 15
                                ? "Running low, top up soon"
                                : "Powers everything you do"
                            : "No usage costs on this network"
                    }
                >
                    {credits.enabled && !credits.isLoading && (
                        <UsageMeter
                            level={credits.level}
                            size="sm"
                            className="mb-1 mt-2"
                        />
                    )}
                </Tile>
                <Tile
                    to="/chainmail"
                    label="Chats"
                    icon={MessageCircle}
                    accent="var(--chart-4)"
                    value={
                        chats.isLoading ? (
                            <Skeleton className="h-7 w-10" />
                        ) : chats.unreadTotal ? (
                            <>
                                {chats.unreadTotal}{" "}
                                <span className="text-muted-foreground text-sm font-normal">
                                    new
                                </span>
                            </>
                        ) : (
                            chats.conversations.length
                        )
                    }
                    sub={
                        chats.unreadTotal
                            ? `from ${unreadPeople} ${unreadPeople === 1 ? "person" : "people"}`
                            : chats.conversations.length
                              ? `${chats.conversations.length === 1 ? "conversation" : "conversations"}, all caught up`
                              : "Say hi to someone"
                    }
                />
                <Tile
                    to="/contacts"
                    label="Contacts"
                    icon={BookUser}
                    accent="var(--chart-2)"
                    value={
                        hasContacts && contacts.isPending ? (
                            <Skeleton className="h-7 w-10" />
                        ) : hasContacts ? (
                            contactCount
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )
                    }
                    sub={
                        hasContacts
                            ? "People you know, in every app"
                            : "Open Contacts to get started"
                    }
                />
            </div>
        </section>
    );
};
