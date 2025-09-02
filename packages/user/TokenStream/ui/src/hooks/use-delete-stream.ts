import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { toast } from "@shared/shadcn/ui/sonner";

const zParams = z.object({
    nftId: z.string(),
});

export const useDeleteStream = () => {
    const navigate = useNavigate();

    return useMutation<void, Error, z.infer<typeof zParams>>({
        mutationKey: ["deleteStream"],
        mutationFn: async (params) => {
            const { nftId } = zParams.parse(params);

            const toastId = toast.loading("Deleting...");

            await supervisor.functionCall({
                method: "delete",
                params: [nftId],
                service: TOKEN_STREAM,
                intf: "api",
            });

            toast.success(`Deleted stream ${nftId}.`, {
                id: toastId,
            });
        },
        onSuccess: (_, { nftId }) => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.stream(nftId),
            });
            navigate("/streams");
        },
    });
};
