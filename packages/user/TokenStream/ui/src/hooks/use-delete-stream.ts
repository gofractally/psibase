import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { TOKEN_STREAM } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { supervisor } from "@shared/lib/supervisor";
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

            await supervisor.functionCall({
                method: "delete",
                params: [nftId],
                service: TOKEN_STREAM,
                intf: "api",
            });
        },
        onSuccess: (_, { nftId }, _result, ctx) => {
            ctx.client.invalidateQueries({
                queryKey: QueryKey.stream(nftId),
            });
            toast.success(`Deleted stream ${nftId}.`);
            navigate("/");
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};
