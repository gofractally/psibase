import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { zAccountNameStatus } from "../use-account-status";

export const zParams = z.object({
    slug: zAccount,
    name: z.string().min(1, { message: "Name is required." }),
    bio: z.string().min(1, { message: "Mission is required." }),
    description: z.string(),
});

export const useCreateGuild = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationKey: QueryKey.createGuild(),
        mutationFn: async (params) => {
            const { slug: account, bio, name } = zParams.parse(params);
            await supervisor.functionCall({
                method: "createGuild",
                params: [account, name, bio],
                service: fractalService,
                intf: "admin",
            });
        },
        onSuccess: (_, { slug: account }) => {
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
