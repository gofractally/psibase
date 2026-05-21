import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PREM_ACCOUNTS_SERVICE } from "@/apps/prem-accounts/lib/prem-service";
import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

type BuyNameInput = {
    accountName: string;
    maxCost: string;
};

export const useBuyName = () => {
    const queryClient = useQueryClient();
    const { data: currentUser } = useCurrentUser();

    return useMutation({
        mutationFn: async ({ accountName, maxCost }: BuyNameInput) => {
            await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                intf: "api",
                method: "buy",
                params: [accountName, maxCost],
            });
            return accountName;
        },
        onMutate: () => ({ toastId: toast.loading("Purchasing name...") }),
        onSuccess: (accountName, _, context) => {
            toast.success(`Account '${accountName}' purchased successfully`, {
                id: context.toastId,
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premPrices(),
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premUnclaimedNames(currentUser),
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premNameEvents(currentUser),
            });
        },
        onError: (error, _, context) => {
            toast.error(error.message, { id: context?.toastId });
        },
    });
};
