import { useMemo } from "react";

import { useAssetMap } from "@/hooks/use-assets";
import { useCreditLines, useObligations } from "@/hooks/use-banx-data";
import {
    groupByCounterpartyAndAsset,
    mergeCreditLines,
    type GroupedAccount,
} from "@/lib/account-groups";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export function useAccountGroups(): {
    user: string | null | undefined;
    savings: GroupedAccount[];
    loans: GroupedAccount[];
    isLoading: boolean;
    isError: boolean;
} {
    const { data: user } = useCurrentUser();
    const {
        byId,
        precisionOf,
        isSuccess: assetsReady,
        isLoading: assetsLoading,
        isError: assetsError,
    } = useAssetMap();
    const { data: obs = [], isLoading: obsLoading } = useObligations();
    const { data: lines = [], isLoading: linesLoading } = useCreditLines();

    const knownLines = useMemo(
        () => lines.filter((line) => byId.has(line.assetId)),
        [lines, byId],
    );

    const savings = useMemo(() => {
        if (!user || !assetsReady) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter(
                    (o) => o.creditor === user && byId.has(o.assetId),
                ),
                (o) => o.debtor,
                precisionOf,
            ),
            knownLines,
            "savings",
            user,
        );
    }, [obs, knownLines, user, precisionOf, assetsReady, byId]);

    const loans = useMemo(() => {
        if (!user || !assetsReady) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.debtor === user && byId.has(o.assetId)),
                (o) => o.creditor,
                precisionOf,
            ),
            knownLines,
            "loan",
            user,
        );
    }, [obs, knownLines, user, precisionOf, assetsReady, byId]);

    return {
        user,
        savings,
        loans,
        isLoading:
            obsLoading ||
            linesLoading ||
            assetsLoading ||
            (!assetsReady && !assetsError),
        isError: assetsError,
    };
}
