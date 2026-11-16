import { ArrowRightLeft, Clock, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useMatch, useSearchParams } from "react-router-dom";

import {
    type Token,
    useUserTokenBalances,
    useUserTokensWithActivity,
    zeroBalanceToken,
} from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { Loading } from "@/components/loading";
import { PageHeader } from "@/components/page-header";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";

import { TokenBalances } from "./components/token-balances";
import { TokenIconSettings } from "./components/token-icon-settings";
import { AutoDebitSwitch } from "./components/transfer/auto-debit-switch";
import { UntransferableTokenWarning } from "./components/transfer/untransferable-warning";
import { WalletStats } from "./components/wallet-stats";
import { useUserPendingBalance } from "./hooks/tokens-plugin/use-pending-balances";
import { useTokenOwnerAccess } from "./hooks/use-token-owner-access";
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
    const isPendingTab =
        useMatch({ path: "/tokens/Pending", end: false }) !== null;
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } =
        useUserTokenBalances(currentUserData);

    const currentUser = isSuccess ? currentUserData : null;

    const { data: pending } = useUserPendingBalance(currentUser);

    const incomingTokenIds = useMemo(
        () =>
            new Set(
                (pending ?? [])
                    .filter((p) => p.debitor === currentUser)
                    .map((p) => p.token.id),
            ),
        [pending, currentUser],
    );

    const { data: activity } = useUserTokensWithActivity(currentUser);

    // Send tab: tokens held now or with past balance changes, so their activity stays reachable
    const activeTokens = useMemo(() => {
        const held = data ?? [];
        const past = (activity ?? [])
            .filter((token) => !held.some((t) => t.id === token.id))
            .map(zeroBalanceToken);
        return [...held, ...past];
    }, [data, activity]);

    // Pending tab: tokens with an open transfer in either direction
    const pendingTokens = useMemo(() => {
        const result = new Map<number, Token>();
        for (const { token } of pending ?? []) {
            if (result.has(token.id)) continue;
            result.set(
                token.id,
                activeTokens.find((t) => t.id === token.id) ??
                    zeroBalanceToken(token),
            );
        }
        return [...result.values()];
    }, [pending, activeTokens]);

    const tokens = isPendingTab ? pendingTokens : activeTokens;
    const tokensReady = isPendingTab ? !!pending : !!data;

    const [selectedTokenId, setSelectedTokenId] = useState<string>("");

    const { handleSetMaxAmount, clearAmountErrors } = useTransferActions();

    const [searchParams, setSearchParams] = useSearchParams();
    const tokenParam = searchParams.get("token");
    useEffect(() => {
        if (!tokenParam) return;
        setSelectedTokenId(tokenParam);
        setSearchParams(
            (params) => {
                params.delete("token");
                return params;
            },
            { replace: true },
        );
    }, [tokenParam, setSearchParams]);

    const handleTokenSelect = (tokenId: string) => {
        setSelectedTokenId(tokenId);
        clearAmountErrors?.();
    };

    // Falls back to the first token when the selection isn't in this tab's list
    const selectedToken =
        tokens.find((token) => token.id == Number(selectedTokenId)) ??
        (tokensReady ? tokens[0] : undefined);

    const { data: ownerAccess } = useTokenOwnerAccess(
        selectedToken?.owner,
        currentUser,
    );

    const pendingForToken = useMemo(
        () =>
            selectedToken
                ? (pending ?? []).filter(
                      (p) => p.balance.tokenNumber === selectedToken.id,
                  )
                : (pending ?? []),
        [pending, selectedToken],
    );
    const incomingCount = (pending ?? []).filter(
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
                            title={isPendingTab ? "Pending Tokens" : "Tokens"}
                            emptyLabel={
                                isPendingTab
                                    ? "No pending transfers"
                                    : "No token activity yet"
                            }
                            tokens={tokens}
                            selectedToken={selectedToken}
                            incomingTokenIds={
                                isPendingTab ? undefined : incomingTokenIds
                            }
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
                            {selectedToken &&
                                ownerAccess &&
                                ownerAccess.kind !== "none" && (
                                    <TokenIconSettings
                                        token={selectedToken}
                                        currentUser={currentUser}
                                        proposeAs={
                                            ownerAccess.kind === "proposal"
                                                ? ownerAccess.proposeAs
                                                : undefined
                                        }
                                    />
                                )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
