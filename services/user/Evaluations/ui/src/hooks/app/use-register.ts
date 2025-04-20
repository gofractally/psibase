import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "../use-current-user";
import { zAccount } from "@lib/zod/Account";
import { z } from "zod";
import { addUserToCache } from "./use-users";

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
                intf: "api",
                params: [params.owner, params.id, currentUser],
            }));

            addUserToCache(params.owner, params.id, currentUser);
        },
    });
};
