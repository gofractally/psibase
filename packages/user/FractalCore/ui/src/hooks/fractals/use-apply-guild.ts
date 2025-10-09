import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zGuildAccount } from "@/lib/zod/Wrappers";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    app: z.string(),
});

export const useApplyGuild = () => {
    const fractal = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { guildAccount, app } = zParams.parse(params);
            await supervisor.functionCall({
                method: "applyGuild",
                service: fractal,
                intf: "user",
                params: [guildAccount, app],
            });
        },
    });
};
