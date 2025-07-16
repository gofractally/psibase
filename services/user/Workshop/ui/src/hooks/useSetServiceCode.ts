import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zodTypes";

import { toast } from "@shared/shadcn/ui/sonner";

import { codeHashQueryKey } from "./useCodeHash";

const Params = z.object({
    account: Account,
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
