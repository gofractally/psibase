import { queryClient } from "@/main";
import { zUser } from "@lib/getUsers";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "./use-current-user";
import { PrivateKey } from "eciesjs";
import { Buffer } from "buffer";
import { storeAsymmetricKey } from "@lib/keys";

globalThis.Buffer = Buffer;

export const useRegister = () => {
    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (id: number) => {
            if (!currentUser) {
                throw new Error("User not found");
            }

            const privateKey = new PrivateKey();
            const publicKey = privateKey.publicKey.toHex();

            console.log({ privateKey, publicKey }, "key pair for registration");
            const secret = privateKey.secret.toString("base64");

            storeAsymmetricKey(id, secret);

            void (await getSupervisor().functionCall({
                method: "register",
                service: "evaluations",
                intf: "api",
                params: [id, publicKey],
            }));

            queryClient.setQueryData(["users", id], (data: unknown) => {
                const users = zUser.array().parse(data);

                const newUser = zUser.parse({
                    user: currentUser,
                    groupNumber: null,
                    proposal: null,
                    submission: null,
                });

                return zUser.array().parse([...users, newUser]);
            });
        },
        onError(error) {
            console.error(error, "is error");
        },
    });
};
