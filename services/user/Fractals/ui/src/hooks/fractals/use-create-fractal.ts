import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@shared/shadcn/ui/sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { zAccountNameStatus } from "../use-account-status";

const zParams = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export const useCreateFractal = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationKey: QueryKey.createFractal(),
        mutationFn: async (params) => {
            const { account, mission, name } = zParams.parse(params);
            toast.promise(
                async () => {
                    void (await supervisor.functionCall({
                        method: "createFractal",
                        params: [zAccount.parse(account), name, mission],
                        service: fractalsService,
                        intf: "admin",
                    }));
                },
                { description: `Created fractal ${name || account}` },
            );
        },
        onSuccess: (_, { account }) => {
            queryClient.setQueryData(
                QueryKey.userAccount(account),
                () => zAccountNameStatus.Enum.Taken,
            );
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
