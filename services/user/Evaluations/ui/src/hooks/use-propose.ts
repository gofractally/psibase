import { queryClient } from "@/main";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "./use-current-user";
import { Buffer } from "buffer";
import { z } from "zod";

globalThis.Buffer = Buffer;

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    proposal: z.number().array(),
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
            const pars = {
                method: "propose",
                service: "evaluations",
                intf: "api",
                params: [
                    evaluationId,
                    groupNumber,
                    proposal.map(String),
                    currentUser,
                ],
            };
            console.log("Proposing...", pars);

            void (await getSupervisor().functionCall(pars));

            console.log("Proposed");

            queryClient.refetchQueries({
                queryKey: ["group", evaluationId, groupNumber],
            });
        },
        onError(error) {
            console.error(error, "is error");
        },
    });
};
