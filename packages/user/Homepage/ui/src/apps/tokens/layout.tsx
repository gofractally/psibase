import { useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router-dom";

import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import {
    type Token,
    useUserTokenBalances,
} from "@/apps/tokens/hooks/tokensPlugin/useUserTokenBalances";

import { GlowingCard } from "@/components/glowing-card";

import { useCurrentUser } from "@/hooks/use-current-user";

import { CardContent } from "@shared/shadcn/ui/card";

import { TokenSelector } from "./components/token-selector";
import { useTransferActions } from "./hooks/use-transfer-actions";

export interface TokensOutletContext {
    selectedToken: Token;
    currentUser: string | null;
    isLoading: boolean;
}

export const TokensLayout = () => {
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } =
        useUserTokenBalances(currentUserData);

    const currentUser = isSuccess ? currentUserData : null;

    const tokens = useMemo(() => data ?? [], [data]);
    const isNoTokens = currentUser && tokens.length == 0;

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

    const isLoading = !isSuccess || isLoadingBalances;

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md">
                {isNoTokens ? (
                    <NoTokensWarning />
                ) : (
                    <div className="space-y-4">
                        <GlowingCard>
                            <CardContent className="@container space-y-2">
                                {!isLoading && (
                                    <TokenSelector
                                        tokens={tokens}
                                        selectedToken={selectedToken}
                                        onChange={handleTokenSelect}
                                        onClickAvailableBalance={
                                            handleSetMaxAmount ?? undefined
                                        }
                                    />
                                )}
                            </CardContent>
                        </GlowingCard>
                        <Outlet
                            context={{ selectedToken, currentUser, isLoading }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
