import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    slug: zAccount,
    name: z.string().min(1, { message: "Name is required." }),
});

export const useCreateGuild = () => {
    const fractalAccount = useFractalAccount();
    return useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationKey: QueryKey.createGuild(),
        mutationFn: async (params) => {
            const { slug, name } = zParams.parse(params);

            await supervisor.functionCall({
                method: "createGuild",
                params: [fractalAccount, name, slug],
                service: fractalService,
                intf: "user",
            });
        },
        onSuccess: (_, { slug: account }) => {
            toast.success(`Created guild ${account}`);
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
};
