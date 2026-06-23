import { useMutation, useQueryClient } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { nameMarket } from "@shared/lib/plugins";
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
                service: nameMarket.service,
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
                queryKey: ["nameMarkets"],
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.nameMarketUnclaimedNames(currentUser),
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.nameMarketEvents(currentUser),
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.userTokenBalances(currentUser),
            });
        },
        onError: (error, _, context) => {
            let message = error.message;
            if (message.includes("has insufficient balance")) {
                message = "Insufficient balance";
            }
            toast.error(message, { id: context?.toastId });
        },
    });
};
