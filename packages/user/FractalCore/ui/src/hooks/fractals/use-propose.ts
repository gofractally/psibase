import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

import { useGuildSlug } from "../use-guild-id";
import { useFractalAccount } from "./use-fractal-account";

const zParams = z.object({
    groupNumber: z.number(),
    proposal: zAccount.array(),
});

export const usePropose = () => {
    const fractalAccount = useFractalAccount();
    const guildSlug = useGuildSlug();
    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { groupNumber, proposal } = zParams.parse(params);

            const pars = {
                method: "propose",
                service: fractalAccount,
                intf: "user",
                params: [guildSlug, groupNumber, proposal],
            };

            void (await getSupervisor().functionCall(pars));
        },
        onError: (error) => {
            const message = "Error proposing:";
            console.error(message, error);
        },
    });
};
