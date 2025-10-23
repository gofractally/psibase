import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { zAccountNameStatus } from "../use-account-status";

export const zParams = z.object({
    fractalAccount: zAccount,
    guildAccount: zAccount,
    name: z.string().min(1, { message: "Name is required." }),
    mission: z.string().min(1, { message: "Mission is required." }),
});

export const useCreateFractal = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationKey: QueryKey.createFractal(),
        mutationFn: async (params) => {
            const { fractalAccount, mission, name, guildAccount } =
                zParams.parse(params);
            await supervisor.functionCall({
                method: "createFractal",
                params: [fractalAccount, guildAccount, name, mission],
                service: fractalsService,
                intf: "adminFractal",
            });
        },
        onSuccess: (_, { fractalAccount: account }) => {
            queryClient.setQueryData(
                QueryKey.userAccount(account),
                () => zAccountNameStatus.Enum.Taken,
            );
            toast.success(`Created fractal ${account}`);
        },
        onError: (error) => {
            if (error instanceof Error) {
                toast.error(error.message);
            } else {
                toast.error("Unrecognized error, check the logs for details.");
                console.error(error);
            }
        },
    });
