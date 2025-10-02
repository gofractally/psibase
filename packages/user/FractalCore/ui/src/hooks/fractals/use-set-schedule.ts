import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zUnix } from "@/lib/zod/Unix";
import { zGuildSlug } from "@/lib/zod/Wrappers";

import { toast } from "@shared/shadcn/ui/sonner";

import { assertUser } from "../use-current-user";
import { setDefaultMembership } from "./use-membership";

const zParams = z.object({
    guildSlug: zGuildSlug,
    fractal: zAccount,
    registration: zUnix,
    deliberation: zUnix,
    submission: zUnix,
    finishBy: zUnix,
    intervalSeconds: z.number(),
});

export const useSetSchedule = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            const {
                guildSlug,
                fractal,
                registration,
                deliberation,
                submission,
                finishBy,
                intervalSeconds,
            } = zParams.parse(params);

            await supervisor.functionCall({
                method: "setSchedule",
                params: [
                    guildSlug,
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    intervalSeconds,
                ],
                service: fractal,
                intf: "admin",
            });
        },
        onSuccess: (_, params) => {
            const { fractal } = zParams.parse(params);

            setDefaultMembership(fractal, assertUser());
            queryClient.refetchQueries({
                queryKey: QueryKey.fractal(fractal),
            });

            toast.success("Schedule updated");
        },
        onError: (error) => {
            const message = "Error setting schedule";
            console.error(message, error);
            toast.error(message);
        },
    });
