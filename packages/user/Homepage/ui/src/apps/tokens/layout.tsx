import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

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
    { to: "/tokens", label: "Send", end: true },
    { to: "/tokens/Pending", label: "Pending", end: false },
];

export const TokensLayout = () => {
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
                description="Send tokens, review activity and manage pending transfers."
                actions={<AutoDebitSwitch currentUser={currentUser} />}
            />

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
                    <div className="flex items-center gap-1">
                        {tabs.map((tab) => (
                            <NavLink
                                key={tab.to}
                                to={tab.to}
                                end={tab.end}
                                className={({ isActive }) =>
                                    cn(
                                        "text-muted-foreground hover:bg-accent/60 hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                                        isActive &&
                                            "bg-accent text-foreground shadow-sm",
                                    )
                                }
                            >
                                {tab.label}
                                {tab.label === "Pending" &&
                                    incomingCount > 0 && (
                                        <span className="rounded bg-amber-500/15 px-1 font-mono text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                                            {incomingCount}
                                        </span>
                                    )}
                            </NavLink>
                        ))}
                    </div>
                    {selectedToken?.isTransferable === false && (
                        <UntransferableTokenWarning />
                    )}
                    <Outlet
                        context={{ selectedToken, currentUser, isLoading }}
                    />
                </div>
            </div>
        </div>
    );
};
