import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zAccount } from "@/lib/zod/Account";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    member: zAccount,
    comment: z.string(),
    endorses: z.boolean(),
});

export const useAttestMembershipApp = () => {
    const fractal = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { comment, endorses, guildAccount, member } =
                zParams.parse(params);
            await supervisor.functionCall({
                method: "attestMembershipApp",
                service: fractal,
                intf: "user",
                params: [guildAccount, member, comment, endorses],
            });
        },
    });
};
