import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { AccountNameStatus } from "../use-account-status";
import { cacheAddFractalMembership } from "./use-fractal-memberships";

const Params = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export const useCreateFractal = () =>
    useMutation<undefined, Error, z.infer<typeof Params>>({
        mutationKey: QueryKey.createFractal(),
        mutationFn: async (params) => {
            const { account, mission, name } = Params.parse(params);
            toast.promise(
                async () => {
                    void (await supervisor.functionCall({
                        method: "createFractal",
                        params: [zAccount.parse(account), name, mission],
                        service: fractalsService,
                        intf: "api",
                    }));
                },
                { description: `Created fractal ${name || account}` },
            );
        },
        onSuccess: (_, { account, mission, name }) => {
            queryClient.setQueryData(
                QueryKey.userAccount(account),
                () => AccountNameStatus.Enum.Taken,
            );

            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractal(account),
                });
            }, AwaitTime);

            cacheAddFractalMembership([
                { account, createdAt: new Date().toISOString(), mission, name },
            ]);
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
