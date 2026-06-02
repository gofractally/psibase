import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "@shared/lib/query-client";
import { type Account } from "@shared/lib/schemas/account";

import { FunctionResponse, getUsersAndGroups } from "../lib/graphql/get-users";

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
