import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zGuildAccount } from "@/lib/zod/Wrappers";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    bio: z.string(),
});

export const useSetGuildBio = () => {
    const fractal = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { guildAccount, bio } = zParams.parse(params);
            await supervisor.functionCall({
                method: "setGuildBio",
                service: fractal,
                intf: "admin",
                params: [guildAccount, bio],
            });
        },
    });
};
