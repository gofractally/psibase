import { useQuery } from "@tanstack/react-query";
import {
    FunctionResponse,
    getUsersAndGroups,
} from "../../lib/graphql/getUsers";
import { Account } from "@/lib/zod/Account";
import { queryClient } from "@/main";
import { z } from "zod";

const genQueryKey = (owner: Account, evaluationId: number) => [
    "users",
    owner,
    evaluationId,
];

export const useUsersAndGroups = (
    owner: Account | undefined | null,
    evaluationId: number | undefined,
    interval: number = 10000,
) =>
    useQuery({
        queryKey: genQueryKey(owner!, evaluationId!),
        queryFn: () => getUsersAndGroups(owner!, evaluationId!),
        enabled: !!evaluationId && !!owner,
        refetchInterval: interval,
    });

export const addUserToCache = (
    owner: Account,
    evaluationId: number,
    currentUser: Account,
) => {
    queryClient.setQueryData(
        genQueryKey(owner!, evaluationId),
        (data: z.infer<typeof FunctionResponse>) => {
            const newResponse: z.infer<typeof FunctionResponse> = {
                ...data,
                users: [
                    ...data.users,
                    {
                        user: currentUser,
                        groupNumber: null,
                        proposal: null,
                        attestation: null,
                        evaluationId,
                    },
                ],
            };

            return FunctionResponse.parse(newResponse);
        },
    );
};
