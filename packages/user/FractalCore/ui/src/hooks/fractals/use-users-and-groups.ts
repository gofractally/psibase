import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { fractalService } from "@/lib/constants";
import {
    getUsersAndGroups,
    zUsersAndGroupsResponse,
} from "@/lib/graphql/evaluations/getUsersAndGroups";
import QueryKey from "@/lib/queryKeys";
import { updateArray } from "@/lib/updateArray";
import { Account } from "@/lib/zod/Account";

import { assertUser } from "../use-current-user";

let attestedEvaluationId: number | undefined;

export const useUsersAndGroups = (
    interval = 10000,
    evaluationId: number | undefined | null,
) =>
    useQuery({
        queryKey: QueryKey.usersAndGroups(evaluationId),
        enabled: !!evaluationId,
        refetchInterval: interval,
        queryFn: async () => {
            try {
                const res = await getUsersAndGroups(
                    fractalService,
                    evaluationId!,
                );

                if (evaluationId === attestedEvaluationId) {
                    const pretendAttestation = [1, 2, 3];
                    return {
                        ...res,
                        users: updateArray(
                            res.users,
                            (user) => user.user === assertUser(),
                            (user) => ({
                                ...user,
                                attestation: pretendAttestation,
                            }),
                        ),
                    };
                } else {
                    return res;
                }
            } catch (error) {
                const message = "Error getting users and groups";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });

export const updateParticipants = (
    evaluationId: number,
    user: Account,
    add = true,
) => {
    queryClient.setQueryData(
        QueryKey.usersAndGroups(evaluationId),
        (data: unknown) => {
            if (data) {
                const existingData = zUsersAndGroupsResponse.parse(data);

                const res: z.infer<typeof zUsersAndGroupsResponse> = {
                    ...existingData,
                    users: [
                        ...existingData.users,
                        {
                            attestation: null,
                            evaluationId,
                            groupNumber: null,
                            proposal: null,
                            user,
                        },
                    ].filter((userData) => add || userData.user !== user),
                };
                return res;
            }
        },
    );
};

export const updateAttestation = (
    evaluationId: number,
    attestation: number[],
) => {
    const currentUser = assertUser();

    attestedEvaluationId = evaluationId;
    queryClient.setQueryData(
        QueryKey.usersAndGroups(evaluationId),
        (data: unknown) => {
            if (data) {
                const existingData = zUsersAndGroupsResponse.parse(data);

                const res: z.infer<typeof zUsersAndGroupsResponse> = {
                    ...existingData,
                    users: updateArray(
                        existingData.users,
                        (user) => user.user === currentUser,
                        (user) => ({
                            ...user,
                            attestation,
                        }),
                    ),
                };

                return res;
            }
        },
    );
};
