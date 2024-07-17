import { chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";
import { postJson } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const connectParam = z.object({
    url: z.string(),
});

export const useConnect = () =>
    useMutation<void, string, z.infer<typeof connectParam>>({
        mutationKey: queryKeys.connect,
        mutationFn: async (param) => {
            try {
                await chain.connect(connectParam.parse(param))
            } catch (e) {
                throw "Failed connecting to node";
            }
        },
    });
