import { queryClient } from "@/main";
import { zUser } from "@lib/graphql/getUsers";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "../use-current-user";
import { PrivateKey } from "eciesjs";
import { Buffer } from "buffer";
import { zAccount } from "@lib/zod/Account";

globalThis.Buffer = Buffer;

export const useRegister = () => {
    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (id: number) => {
            if (!currentUser) {
                throw new Error("User not found");
            }

            void (await getSupervisor().functionCall({
                method: "register",
                service: "evaluations",
                intf: "api",
                params: [id, zAccount.parse(currentUser)],
            }));

            queryClient.setQueryData(["users", id], (data: unknown) => {
                const users = zUser.array().parse(data);

                const newUser = zUser.parse({
                    user: currentUser,
                    groupNumber: null,
                    proposal: null,
                    attestation: null,
                });

                return zUser.array().parse([...users, newUser]);
            });
        },
        onError(error) {
            console.error(error, "is error");
        },
    });
};
