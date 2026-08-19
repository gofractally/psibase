import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import QueryKey from "@/lib/query-keys";

import { zAccount } from "@shared/lib/schemas/account";
import { toast } from "@shared/shadcn/ui/sonner";

import { useGuildAccount } from "../use-guild-account";
import { useFractalAccount } from "./use-fractal-account";

const zParams = z.object({
    groupNumber: z.number(),
    proposal: zAccount.array(),
});

export const usePropose = () => {
    const fractalAccount = useFractalAccount();
    const guildAccount = useGuildAccount();
    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { groupNumber, proposal } = zParams.parse(params);

            const pars = {
                method: "propose",
                service: fractalAccount,
                intf: "userEval",
                params: [guildAccount, groupNumber, proposal],
            };

            void (await getSupervisor().functionCall(pars));
        },
        onSuccess: (_data, variables, _onMutateResult, context) => {
            context.client.invalidateQueries({
                queryKey: QueryKey.proposal(
                    guildAccount,
                    variables.groupNumber,
                ),
            });
        },
        onError: (error) => {
            const message = "Error submitting proposal";
            console.error(message, error);
            toast.error(message, {
                description: error.message,
            });
        },
    });
};
