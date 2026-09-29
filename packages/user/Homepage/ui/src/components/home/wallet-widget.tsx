import { ArrowDownLeft, ArrowRight, Coins, Lock } from "lucide-react";
import { Link } from "react-router-dom";

import { useUserPendingBalance } from "@/apps/tokens/hooks/tokens-plugin/use-pending-balances";
import { useUserTokenBalances } from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";

import { colorFor } from "@/lib/colors";

import { useSystemToken } from "@shared/hooks/use-system-token";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const LIMIT = 5;

export const WalletWidget = ({ user }: { user: string }) => {
    const { data: systemToken } = useSystemToken();
    const { data: balances, isPending } = useUserTokenBalances(user);
    const { data: pending } = useUserPendingBalance(user);
    const incoming = pending?.filter((p) => p.debitor === user) ?? [];

    const sorted = [...(balances ?? [])].sort((a, b) => {
        const sys = Number(systemToken?.id);
        if (a.id === sys) return -1;
        if (b.id === sys) return 1;
        return (b.balance?.amount ?? 0) - (a.balance?.amount ?? 0);
    });
    const shown = sorted.slice(0, LIMIT);
    const more = sorted.length - shown.length;

    return (
        <Panel
            title="Wallet"
            description="Tokens you can use anywhere on the network"
            headerClassName="px-5 py-4"
            actions={
                <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                >
                    <Link to="/tokens">
                        Open
                        <ArrowRight className="size-3.5" />
                    </Link>
                </Button>
            }
        >
            {incoming.length > 0 && (
                <Link
                    to="/tokens/Pending"
                    className="flex items-center gap-3.5 border-b bg-emerald-500/10 px-5 py-3.5 text-sm transition-colors hover:bg-emerald-500/15"
                >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <ArrowDownLeft className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="font-medium">
                            {incoming.length}{" "}
                            {incoming.length === 1 ? "transfer" : "transfers"}{" "}
                            waiting for you
                        </span>
                        <span className="text-muted-foreground block text-xs">
                            Review and accept them in your wallet
                        </span>
                    </span>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                </Link>
            )}
            {isPending ? (
                <div className="flex flex-col gap-3 p-5">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                    ))}
                </div>
            ) : shown.length === 0 ? (
                <EmptyState
                    icon={Coins}
                    className="min-h-40"
                    detail="Tokens you receive land here, and you can use them in any app."
                >
                    No tokens yet
                </EmptyState>
            ) : (
                <ul className="divide-y">
                    {shown.map((t) => {
                        const symbol = t.symbol?.toUpperCase() ?? `#${t.id}`;
                        return (
                            <li
                                key={t.id}
                                className="flex items-center gap-3.5 px-5 py-3"
                            >
                                <span
                                    className="flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold"
                                    style={{
                                        color: colorFor(symbol),
                                        borderColor: `color-mix(in oklch, ${colorFor(symbol)} 40%, transparent)`,
                                        backgroundColor: `color-mix(in oklch, ${colorFor(symbol)} 12%, transparent)`,
                                    }}
                                >
                                    {symbol.slice(0, 3)}
                                </span>
                                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
                                    <span className="truncate">{t.label}</span>
                                    {t.id === Number(systemToken?.id) && (
                                        <span className="text-muted-foreground rounded border px-1 text-[10px] font-normal">
                                            network
                                        </span>
                                    )}
                                    {!t.isTransferable && (
                                        <Lock className="text-muted-foreground size-3" />
                                    )}
                                </span>
                                <span className="font-mono text-sm tabular-nums">
                                    {t.balance?.format({ includeLabel: false })}
                                </span>
                            </li>
                        );
                    })}
                    {more > 0 && (
                        <li>
                            <Link
                                to="/tokens"
                                className="text-muted-foreground hover:text-foreground block px-5 py-3 text-xs"
                            >
                                +{more} more
                            </Link>
                        </li>
                    )}
                </ul>
            )}
        </Panel>
    );
};
