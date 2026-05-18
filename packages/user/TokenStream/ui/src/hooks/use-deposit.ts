import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/query-keys";

import { supervisor } from "@shared/lib/supervisor";
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

            await supervisor.functionCall({
                method: "deposit",
                params: [nftId, tokenId, amount, memo],
                service: TOKEN_STREAM,
                intf: "api",
            });
        },
        onSuccess: (_, { nftId }, _result, ctx) => {
            ctx.client.invalidateQueries({
                queryKey: QueryKey.stream(nftId),
            });

            toast.success("Deposited into stream.");
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
