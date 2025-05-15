import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { AccountNameStatus } from "../useAccountStatus";
import { cacheAddFractalMembership } from "./useFractalMemberships";

const Params = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export const useCreateFractal = () =>
    useMutation<null, Error, z.infer<typeof Params>>({
        mutationKey: QueryKey.createFractal(),
        mutationFn: async (params) => {
            const { account, mission, name } = Params.parse(params);
            void (await supervisor.functionCall({
                method: "createFractal",
                params: [zAccount.parse(account), name, mission],
                service: fractalsService,
                intf: "api",
            }));
            return null;
        },
        onSuccess: (_, { account, mission, name }) => {
            queryClient.setQueryData(
                QueryKey.userAccount(account),
                () => AccountNameStatus.Enum.Taken,
            );

            queryClient.setQueryData(QueryKey.fractal(account), () => null);
            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractal(account),
                });
            }, AwaitTime);

            cacheAddFractalMembership([
                { account, createdAt: new Date().toISOString(), mission, name },
            ]);

            toast.success(`Created fractal ${name || account}`);
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
