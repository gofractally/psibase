import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "./use-plugin-mutation";

const refreshAccounts = () => {
    void queryClient.invalidateQueries({ queryKey: ["accountsByPrefix"] });
    void queryClient.invalidateQueries({
        queryKey: QueryKey.frozenAccounts(),
    });
};

export const useFreezeAccounts = () =>
    usePluginMutation<[string[], string | undefined]>(
        {
            service: CONFIG,
            method: "freeze",
            intf: "accounts",
        },
        {
            error: "Failed to propose freeze",
            loading: "Proposing freeze..",
            success: "Proposed freeze",
            isStagable: true,
            onSuccess: () => {
                refreshAccounts();
            },
        },
    );

export const useUnfreezeAccounts = () =>
    usePluginMutation<[string[], string | undefined]>(
        {
            service: CONFIG,
            method: "unfreeze",
            intf: "accounts",
        },
        {
            error: "Failed to propose unfreeze",
            loading: "Proposing unfreeze..",
            success: "Proposed unfreeze",
            isStagable: true,
            onSuccess: () => {
                refreshAccounts();
            },
        },
    );
