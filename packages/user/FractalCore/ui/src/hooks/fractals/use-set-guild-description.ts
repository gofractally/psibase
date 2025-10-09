import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zGuildAccount } from "@/lib/zod/Wrappers";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    description: z.string(),
});

export const useSetGuildDescription = () => {
    const fractal = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { guildAccount, description } = zParams.parse(params);
            await supervisor.functionCall({
                method: "setGuildDescription",
                service: fractal,
                intf: "admin",
                params: [guildAccount, description],
            });
        },
    });
};
