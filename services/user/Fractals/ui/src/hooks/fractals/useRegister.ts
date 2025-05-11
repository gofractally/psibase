import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";

import { useCurrentUser } from "../useCurrentUser";

const Params = z.object({
    owner: zAccount,
    id: z.number(),
    registrant: zAccount,
});

export const useRegister = () => {
    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            if (!currentUser) {
                throw new Error("User not found");
            }

            void (await getSupervisor().functionCall({
                method: "register",
                service: fractalsService,
                intf: "api",
                params: [params.owner, params.id, currentUser],
            }));

            // TODO:
            // addUserToCache(params.owner, params.id, currentUser);
        },
    });
};
