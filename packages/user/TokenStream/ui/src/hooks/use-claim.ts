import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { TOKEN_STREAM } from "@/lib/constants";

import { toast } from "@shared/shadcn/ui/sonner";

const zParams = z.object({
    nftId: z.string(),
});

export const useClaim = () =>
    useMutation<void, Error, z.infer<typeof zParams>>({
        mutationKey: ["claim"],
        mutationFn: async (params) => {
            const { nftId } = zParams.parse(params);

            const toastId = toast.loading("Claiming...");
            await supervisor.functionCall({
                method: "claim",
                params: [nftId],
                service: TOKEN_STREAM,
                intf: "api",
            });

            toast.success(`Claimed from stream.`, {
                id: toastId,
            });
        },
    });
