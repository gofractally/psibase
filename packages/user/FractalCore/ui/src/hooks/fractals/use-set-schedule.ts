import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zUnix } from "@/lib/zod/Unix";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { toast } from "@shared/shadcn/ui/sonner";

import { assertUser } from "../use-current-user";
import { setDefaultMembership } from "./use-membership";

const zParams = z.object({
    guildAccount: zGuildAccount,
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
                guildAccount,
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
                    guildAccount,
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
            const { fractal, guildAccount } = zParams.parse(params);

            setDefaultMembership(fractal, assertUser());
            queryClient.refetchQueries({
                queryKey: QueryKey.fractal(fractal),
            });
            queryClient.refetchQueries({
                queryKey: QueryKey.guild(guildAccount),
            });

            toast.success("Schedule updated");
        },
        onError: (error) => {
            const message = "Error setting schedule";
            console.error(message, error);
            toast.error(message);
        },
    });
