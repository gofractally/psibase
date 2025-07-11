import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

import { useCurrentUser } from "../use-current-user";
import { addUserToCache } from "./use-users";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
                service: "evaluations",
                intf: "user",
                params: [params.owner, params.id, currentUser],
            }));

            addUserToCache(params.owner, params.id, currentUser);
        },
    });
};
