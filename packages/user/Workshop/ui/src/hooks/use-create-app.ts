import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "@shared/lib/query-client";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { AccountNameStatus } from "./use-account-status";
import { appMetadataQueryKey } from "./use-app-metadata";

const Params = z.object({
    account: zAccount,
    allowExistingAccount: z.boolean(),
});

const Result = z.enum(["Created", "Added"]);

export const useCreateApp = () =>
    useMutation<z.infer<typeof Result>, Error, z.infer<typeof Params>>({
        mutationKey: ["createApp"],
        mutationFn: async (params) => {
            const { account, allowExistingAccount } = Params.parse(params);
            try {
                void (await supervisor.functionCall({
                    method: "createApp",
                    params: [zAccount.parse(account)],
                    service: "workshop",
                    intf: "registry",
                }));
                return Result.Enum.Created;
            } catch (e) {
                const isExistingAccount =
                    e instanceof Error &&
                    e.message.includes("account already exists");
                if (!isExistingAccount || !allowExistingAccount) throw e;
                return Result.Enum.Added;
            }
        },
        onSuccess: (result, { account }) => {
            queryClient.setQueryData(
                ["userAccount", account],
                () => AccountNameStatus.Enum.Taken,
            );

            queryClient.setQueryData(appMetadataQueryKey(account), () => null);
            queryClient.invalidateQueries({
                queryKey: appMetadataQueryKey(account),
            });

            if (result === Result.Enum.Added) {
                toast.success(`Added app ${account}`);
            } else if (result == Result.Enum.Created) {
                toast.success(`Created app ${account}`);
            }
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
