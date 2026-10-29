import { ArrowRightLeft, Clock, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useMatch } from "react-router-dom";

import {
    type Token,
    useUserTokenBalances,
} from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { Loading } from "@/components/loading";
import { PageHeader } from "@/components/page-header";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";

import { TokenBalances } from "./components/token-balances";
import { AutoDebitSwitch } from "./components/transfer/auto-debit-switch";
import { UntransferableTokenWarning } from "./components/transfer/untransferable-warning";
import { WalletStats } from "./components/wallet-stats";
import { useUserPendingBalance } from "./hooks/tokens-plugin/use-pending-balances";
import { useTransferActions } from "./hooks/use-transfer-actions";

export interface TokensOutletContext {
    selectedToken: Token | undefined;
    currentUser: string | null;
    isLoading: boolean;
}

const tabs = [
    { to: "/tokens", label: "Send", icon: Send, end: true },
    { to: "/tokens/Pending", label: "Pending", icon: Clock, end: false },
    { to: "/tokens/swap", label: "Swap", icon: ArrowRightLeft, end: false },
];

const WalletTabs = ({ pendingCount }: { pendingCount: number }) => (
    <nav className="-mt-1 flex gap-1 border-b" aria-label="Wallet sections">
        {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                    cn(
                        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2.5 pt-1 text-sm font-medium transition-colors",
                        isActive
                            ? "text-foreground border-[var(--brand)]"
                            : "text-muted-foreground hover:text-foreground border-transparent",
                    )
                }
            >
                <Icon className="size-3.5" />
                {label}
                {label === "Pending" && pendingCount > 0 && (
                    <span className="rounded bg-amber-500/15 px-1 font-mono text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                        {pendingCount}
                    </span>
                )}
            </NavLink>
        ))}
    </nav>
);

export const TokensLayout = () => {
    const isSwap = useMatch("/tokens/swap") !== null;
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } =
        useUserTokenBalances(currentUserData);

    const currentUser = isSuccess ? currentUserData : null;

    const tokens = useMemo(() => data ?? [], [data]);

    const [selectedTokenId, setSelectedTokenId] = useState<string>("");

    const { handleSetMaxAmount, clearAmountErrors } = useTransferActions();

    useEffect(() => {
        if (selectedTokenId) return;
        if (tokens.length === 0) return;
        setSelectedTokenId(tokens[0].id.toString());
    }, [selectedTokenId, tokens]);

    const handleTokenSelect = (tokenId: string) => {
        setSelectedTokenId(tokenId);
        clearAmountErrors?.();
    };

    const selectedToken = tokens.find(
        (balance) => balance.id == Number(selectedTokenId),
    );

    const { data: pending } = useUserPendingBalance(currentUser);
    const pendingForToken = useMemo(
        () =>
            selectedToken
                ? (pending ?? []).filter(
                      (p) => p.balance.tokenNumber === selectedToken.id,
                  )
                : (pending ?? []),
        [pending, selectedToken],
    );
    const incomingCount = pendingForToken.filter(
        (p) => p.debitor === currentUser,
    ).length;

    const isLoading = !isSuccess || isLoadingBalances;

    if (isLoading) {
        return <Loading className="flex-1" label="Loading wallet…" />;
    }

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title="Wallet"
                description="Send, receive and swap tokens."
                actions={<AutoDebitSwitch currentUser={currentUser} />}
            />
            <WalletTabs pendingCount={incomingCount} />

            {isSwap ? (
                <Outlet />
            ) : (
                <>
                    <WalletStats
                        selectedToken={selectedToken}
                        tokens={tokens}
                        pending={pendingForToken}
                        currentUser={currentUser}
                        onClickAvailable={handleSetMaxAmount ?? undefined}
                    />

                    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
                        <TokenBalances
                            tokens={tokens}
                            selectedToken={selectedToken}
                            onSelect={handleTokenSelect}
                        />

                        <div className="flex min-w-0 flex-col gap-4">
                            {selectedToken?.isTransferable === false && (
                                <UntransferableTokenWarning />
                            )}
                            <Outlet
                                context={{
                                    selectedToken,
                                    currentUser,
                                    isLoading,
                                }}
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
