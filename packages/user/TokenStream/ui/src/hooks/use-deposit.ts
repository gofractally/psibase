import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { toast } from "@shared/shadcn/ui/sonner";

const zParams = z.object({
    amount: z.string(),
    nftId: z.string(),
    tokenId: z.string(),
    memo: z.string(),
});

export const useDeposit = () =>
    useMutation<void, Error, z.infer<typeof zParams>>({
        mutationKey: ["deposit"],
        mutationFn: async (params) => {
            const { amount, nftId, tokenId, memo } = zParams.parse(params);

            const toastId = toast.loading("Depositing...");

            await supervisor.functionCall({
                method: "deposit",
                params: [nftId, tokenId, amount, memo],
                service: TOKEN_STREAM,
                intf: "api",
            });

            toast.success(`Deposited into stream.`, {
                id: toastId,
                description: `${amount}`,
            });
        },
        onSuccess: (_, { nftId }) => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.stream(nftId),
            });
        },
    });
