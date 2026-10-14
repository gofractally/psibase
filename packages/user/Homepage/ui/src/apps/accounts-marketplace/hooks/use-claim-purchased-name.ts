import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ACCOUNT_MARKETPLACE_CLAIM_PATH } from "@/apps/accounts-marketplace/route";

import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { useClaimAndSetKey } from "./use-claim-and-set-key";

/**
 * Claim returns the only copy of the new key. Keep it, keyed by account,
 * so a failed prompt open can retry without claiming again.
 */
export const useClaimPurchasedName = (account: string) => {
    const [claimedKey, setClaimedKey] = useState<{
        account: string;
        key: string;
    } | null>(null);

    const queryClient = useQueryClient();
    const { data: currentUser } = useCurrentUser();
    const claimMutation = useClaimAndSetKey();
    const importMutation = useMutation({
        mutationFn: async (key: string) => {
            await supervisor.functionCall(
                {
                    service: "host",
                    plugin: "accounts",
                    intf: "activeApp",
                    method: "importNewAccount",
                    params: [account, key, false],
                },
                {
                    enabled: true,
                    returnPath: ACCOUNT_MARKETPLACE_CLAIM_PATH,
                },
            );
        },
    });
    const savedKey =
        claimedKey?.account === account ? claimedKey.key : undefined;

    const continueClaim = async () => {
        let key = savedKey;
        if (!key) {
            try {
                key = await claimMutation.mutateAsync([account]);
            } catch (error) {
                console.error("Failed to claim account:", error);
                return;
            }
            setClaimedKey({ account, key });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.nameMarketUnclaimedNames(currentUser),
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.nameMarketEvents(currentUser),
            });
        }

        try {
            await importMutation.mutateAsync(key);
        } catch (error) {
            console.error("Failed to open import prompt:", error);
            toast.error("Failed to open the import prompt", {
                description:
                    error instanceof Error ? error.message : undefined,
            });
        }
    };

    return {
        continueClaim,
        isClaiming: claimMutation.isPending,
        isOpeningImport: importMutation.isPending,
    };
};
