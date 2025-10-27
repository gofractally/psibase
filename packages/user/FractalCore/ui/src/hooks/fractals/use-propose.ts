import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

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
        onError: (error) => {
            const message = "Error proposing:";
            console.error(message, error);
        },
    });
};
