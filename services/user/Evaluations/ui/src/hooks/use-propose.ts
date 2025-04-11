import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "./use-current-user";
import { z } from "zod";
import { useDebounceCallback } from "usehooks-ts";
import { useRef } from "react";
import { getProposal } from "@lib/getProposal";
import { setCachedProposal } from "./use-proposal";

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    proposal: z.number().array(),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        },
    });
};
