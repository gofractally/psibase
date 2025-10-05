import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zGuildSlug } from "@/lib/zod/Wrappers";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildSlug: zGuildSlug,
    app: z.string(),
});

export const useApplyGuild = () => {
    const fractal = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { guildSlug, app } = zParams.parse(params);
            await supervisor.functionCall({
                method: "applyGuild",
                service: fractal,
                intf: "user",
                params: [guildSlug, app],
            });
        },
    });
};
