import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "@shared/lib/queryClient";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { codeHashQueryKey } from "./use-code-hash";

const Params = z.object({
    account: zAccount,
    code: z.any(),
});

export const useSetServiceCode = () =>
    useMutation<null, Error, z.infer<typeof Params>>({
        mutationKey: ["setServiceCode"],
        mutationFn: async (params) => {
            const { account, code } = Params.parse(params);

            const args = {
                method: "setServiceCode",
                params: [account, code],
                service: "workshop",
                intf: "app",
            };

            void (await supervisor.functionCall(args));

            return null;
        },
        onSuccess: (_, params) => {
            toast("Success", {
                description: `Uploaded service to ${params.account}`,
            });

            queryClient.invalidateQueries({
                queryKey: codeHashQueryKey(params.account),
            });
        },
        onError: (error) => {
            if (error instanceof Error) {
                toast("Error", {
                    description: `Failed uploading service ${error.message}`,
                });
            } else {
                console.error(error);
                toast("Error", {
                    description: `Failed uploading service, see log for details`,
                });
            }
        },
    });
