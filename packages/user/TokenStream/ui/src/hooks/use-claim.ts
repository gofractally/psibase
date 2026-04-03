import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

const zParams = z.object({
    nftId: z.string(),
});

export const useClaim = () =>
    useMutation<void, Error, z.infer<typeof zParams>>({
        mutationKey: ["claim"],
        mutationFn: async (params) => {
            const { nftId } = zParams.parse(params);

            await supervisor.functionCall({
                method: "claim",
                params: [nftId],
                service: TOKEN_STREAM,
                intf: "api",
            });
        },
        onSuccess: (_, { nftId }, _result, ctx) => {
            ctx.client.invalidateQueries({
                queryKey: QueryKey.stream(nftId),
            });
            ctx.client.invalidateQueries({
                queryKey: QueryKey.streams(),
            });
            toast.success("Claimed from stream.");
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
