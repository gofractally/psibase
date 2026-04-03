import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

const zParams = z.object({
    halfLifeSeconds: z.number().int().positive(),
    tokenId: z.number().positive(),
});

export const useCreateStream = () =>
    useMutation<void, Error, z.infer<typeof zParams>>({
        mutationKey: ["createStream"],
        mutationFn: async (params) => {
            const { halfLifeSeconds, tokenId } = zParams.parse(params);

            await supervisor.functionCall({
                method: "create",
                params: [halfLifeSeconds, tokenId],
                service: TOKEN_STREAM,
                intf: "api",
            });
        },
        onSuccess: (_, __, _result, ctx) => {
            ctx.client.invalidateQueries({ queryKey: QueryKey.streams() });
            toast.success("Created stream.");
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
