import type { PendingBalance } from "../hooks/tokens-plugin/use-pending-balances";
import type { Token } from "../hooks/tokens-plugin/use-user-token-balances";

import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";

import { StatCard } from "@/components/stat-card";

import { Quantity } from "@shared/lib/quantity";

import { AnimateNumber } from "./animate-number";

const sum = (items: PendingBalance[], token: Token | undefined) => {
    if (!token) return null;
    const total = items.reduce((acc, p) => acc + p.balance.amount, 0);
    try {
        return new Quantity(total, token.precision, token.id, token.symbol);
    } catch {
        return null;
    }
};

export const WalletStats = ({
    selectedToken,
    tokens,
    pending,
    currentUser,
    onClickAvailable,
}: {
    selectedToken?: Token;
    tokens: Token[];
    pending: PendingBalance[];
    currentUser: string | null;
    onClickAvailable?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
    const incoming = pending.filter((p) => p.debitor === currentUser);
    const outgoing = pending.filter((p) => p.creditor === currentUser);
    const incomingTotal = sum(incoming, selectedToken);
    const outgoingTotal = sum(outgoing, selectedToken);
    const label = selectedToken?.label ?? "";

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
                label={selectedToken ? `Available · ${label}` : "Available"}
                icon={Wallet}
                accent="var(--chart-1)"
                value={
                    selectedToken ? (
                        <AnimateNumber
                            n={selectedToken.balance?.amount ?? 0}
                            precision={selectedToken.balance?.precision ?? 0}
                            className="hover:cursor-pointer hover:underline"
                            onClick={onClickAvailable}
                            useFullPrecision
                        />
                    ) : (
                        <span className="text-muted-foreground text-base">
                            —
                        </span>
                    )
                }
                sub={
                    selectedToken
                        ? tokens.length > 1
                            ? `${tokens.length} tokens · click amount to send max`
                            : "click amount to send max"
                        : "select a token"
                }
            />
            <StatCard
                label="Pending in"
                icon={ArrowDownLeft}
                accent={incoming.length ? "var(--chart-3)" : "var(--chart-2)"}
                value={
                    incomingTotal ? (
                        incomingTotal.format({ includeLabel: false })
                    ) : (
                        <span className="text-muted-foreground text-base">
                            —
                        </span>
                    )
                }
                sub={
                    incoming.length
                        ? `${incoming.length} transfer${incoming.length === 1 ? "" : "s"} awaiting your acceptance`
                        : "nothing waiting on you"
                }
            />
            <StatCard
                label="Pending out"
                icon={ArrowUpRight}
                accent="var(--chart-4)"
                value={
                    outgoingTotal ? (
                        outgoingTotal.format({ includeLabel: false })
                    ) : (
                        <span className="text-muted-foreground text-base">
                            —
                        </span>
                    )
                }
                sub={
                    outgoing.length
                        ? `${outgoing.length} transfer${outgoing.length === 1 ? "" : "s"} awaiting a counterparty`
                        : "no outbound credits open"
                }
            />
        </div>
    );
};
