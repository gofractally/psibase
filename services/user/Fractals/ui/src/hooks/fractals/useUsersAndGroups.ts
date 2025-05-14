import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import {
    UsersAndGroupsResponse,
    getUsersAndGroups,
} from "@/lib/graphql/evaluations/getUsersAndGroups";
import QueryKey from "@/lib/queryKeys";
import { updateArray } from "@/lib/updateArray";

import { assertUser } from "../useCurrentUser";

export const useUsersAndGroups = (
    interval = 10000,
    evaluationId: number | undefined | null,
) =>
    useQuery({
        queryKey: QueryKey.usersAndGroups(evaluationId),
        enabled: !!evaluationId,
        refetchInterval: interval,
        queryFn: async () => {
            return getUsersAndGroups(fractalsService, evaluationId!);
        },
    });

export const updateAttestation = (
    evaluationId: number,
    attestation: number[],
) => {
    const currentUser = assertUser();

    queryClient.setQueryData(
        QueryKey.usersAndGroups(evaluationId),
        (data: any) => {
            if (data) {
                const existingData = UsersAndGroupsResponse.parse(data);

                const res: z.infer<typeof UsersAndGroupsResponse> = {
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
