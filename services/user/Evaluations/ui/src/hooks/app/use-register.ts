import { queryClient } from "@/main";
import { zUser } from "@lib/graphql/getUsers";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "../use-current-user";
import { zAccount } from "@lib/zod/Account";
import { z } from "zod";

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

            queryClient.setQueryData(
                ["users", params.owner, params.id],
                (data: unknown) => {
                    const users = zUser.array().parse(data);

                    const newUserObject: z.infer<typeof zUser> = {
                        user: currentUser,
                        groupNumber: null,
                        proposal: null,
                        attestation: null,
                        evaluationId: params.id,
                    };

                    const newUser = zUser.parse(newUserObject);

                    return zUser.array().parse([...users, newUser]);
                },
            );
        },
    });
};
