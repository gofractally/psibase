import { queryClient } from "@/main";
import { Group } from "@lib/getGroup";
import { zAccount } from "@lib/zod/Account";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    keys: z.any().array(),
    hash: z.string(),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useSetGroupKey = () =>
    useMutation({
        onError: (error) => {
            window.alert(error.message);
        },
        mutationFn: async (params: z.infer<typeof Params>) => {
            const { evaluationId, groupNumber, keys, hash } =
                Params.parse(params);
            try {
                void (await getSupervisor().functionCall({
                    service: "evaluations",
                    method: "groupKey",
                    params: [evaluationId, keys, hash],
                    intf: "api",
                }));

                // throw a custom error if there is no aAccount
                const currentUser = zAccount.safeParse(
                    queryClient.getQueryData(["currentUser"]),
                );
                if (!currentUser.success) {
                    throw new Error("No current user found");
                }

                queryClient.setQueryData(
                    ["group", evaluationId, groupNumber],
                    (group: Group) => ({
                        ...group,
                        keys: keys,
                        keySubmitter: currentUser.data,
                        keyHash: hash,
                    }),
                );
                await wait(3000);
                queryClient.refetchQueries({
                    queryKey: ["group", evaluationId, groupNumber],
                });
            } catch (e) {
                // detect if the key already exists, if so, just do a couple refetches
                if (
                    e instanceof Error &&
                    e.message.includes("key already exists")
                ) {
                    queryClient.refetchQueries({
                        queryKey: ["group", evaluationId, groupNumber],
                    });
                } else {
                    console.error("Unknown error on setting key", e);
                    throw e;
                }
            }
        },
    });
