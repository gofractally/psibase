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
} {
    const { data: user } = useCurrentUser();
    const { precisionOf } = useAssetMap();
    const { data: obs = [], isLoading: obsLoading } = useObligations();
    const { data: lines = [], isLoading: linesLoading } = useCreditLines();

    const savings = useMemo(() => {
        if (!user) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.creditor === user),
                (o) => o.debtor,
                precisionOf,
            ),
            lines,
            "savings",
            user,
        );
    }, [obs, lines, user, precisionOf]);

    const loans = useMemo(() => {
        if (!user) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.debtor === user),
                (o) => o.creditor,
                precisionOf,
            ),
            lines,
            "loan",
            user,
        );
    }, [obs, lines, user, precisionOf]);

    return {
        user,
        savings,
        loans,
        isLoading: obsLoading || linesLoading,
    };
}
