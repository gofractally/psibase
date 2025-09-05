import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

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

            const toastId = toast.loading("Creating stream...");
            await supervisor.functionCall({
                method: "create",
                params: [halfLifeSeconds, tokenId],
                service: TOKEN_STREAM,
                intf: "api",
            });

            toast.success("Created stream.", { id: toastId });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKey.streams() });
        },
    });
