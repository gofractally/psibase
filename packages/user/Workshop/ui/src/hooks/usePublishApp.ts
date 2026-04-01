import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

const Params = z.object({
    account: zAccount,
    publish: z.boolean(),
});

export const usePublishApp = () =>
    useMutation<null, Error, z.infer<typeof Params>>({
        mutationKey: ["publishApp"],
        mutationFn: async (params) => {
            const { account, publish } = Params.parse(params);

            await supervisor.functionCall({
                method: publish ? "publishApp" : "unpublishApp",
                params: [account],
                service: "workshop",
                intf: "registry",
            });

            return null;
        },
    });
