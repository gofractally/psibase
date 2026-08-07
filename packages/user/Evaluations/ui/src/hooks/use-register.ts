import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { EVALUATIONS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

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

            void (await supervisor.functionCall({
                method: "register",
                service: EVALUATIONS_SERVICE,
                intf: "user",
                params: [params.owner, params.id, currentUser],
            }));

            addUserToCache(params.owner, params.id, currentUser);
        },
    });
};
