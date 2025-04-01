import { queryClient } from "@/main";
import { zUser } from "@lib/getUsers";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "./use-current-user";
import { PrivateKey } from "eciesjs";
import { Buffer } from "buffer";
import { z } from "zod";

globalThis.Buffer = Buffer;

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    proposal: z.instanceof(Uint8Array),
});

export const usePropose = () => {
    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            const { evaluationId, groupNumber, proposal } =
                Params.parse(params);
            if (!currentUser) {
                throw new Error("User not found");
            }

            void (await getSupervisor().functionCall({
                method: "propose",
                service: "evaluations",
                intf: "api",
                params: [evaluationId, proposal],
            }));

            queryClient.refetchQueries({
                queryKey: ["group", evaluationId, groupNumber],
            });
        },
        onError(error) {
            console.error(error, "is error");
        },
    });
};
