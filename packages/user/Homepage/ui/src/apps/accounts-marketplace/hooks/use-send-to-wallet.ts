import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { callPluginFunction, nameMarket } from "@shared/lib/plugins";
import { toast } from "@shared/shadcn/ui/sonner";

export function useSendToWallet(user?: string | null) {
    const queryClient = useQueryClient();
    const queryKey = ["namemarket", "sendToWallet", user] as const;

    const query = useQuery({
        queryKey,
        enabled: !!user,
        queryFn: () => callPluginFunction(nameMarket.api.isSendToWallet, []),
    });

    const mutation = useMutation({
        mutationFn: (enabled: boolean) =>
            callPluginFunction(nameMarket.api.setSendToWallet, [enabled]),
        onSuccess: (_data, enabled) => {
            queryClient.setQueryData(queryKey, enabled);
        },
        onError: (error) => {
            toast.error(error.message || "Could not update send to wallet");
        },
    });

    return { query, mutation };
}
