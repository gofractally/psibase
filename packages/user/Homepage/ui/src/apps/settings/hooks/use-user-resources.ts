import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { vserver } from "@shared/lib/plugins";

interface UserResourcesResponse {
    userResources: {
        balance: string | number;
        bufferCapacity: string | number;
        autoFillThresholdPercent: string | number;
    };
}

export interface UserResources {
    balance: number;
    bufferCapacity: number;
    autoFillThresholdPercent: number;
}

export const useUserResources = (
    user: string | null | undefined,
    options?: { enabled?: boolean },
) => {
    const { enabled = true } = options ?? {};
    return useQuery<UserResources | null>({
        queryKey: [...QueryKey.userResources(), user],
        enabled: !!user && enabled,
        queryFn: async () => {
            if (!user) return null;

            const query = `
                query {
                    userResources(account: "${user}") {
                        balance
                        bufferCapacity
                        autoFillThresholdPercent
                    }
                }
            `;

            const data = await callGraphqlViaPlugin<UserResourcesResponse>(
                vserver.authorized.graphql,
                query,
            );

            if (!data.userResources) {
                return null;
            }

            return {
                balance: Number(data.userResources.balance),
                bufferCapacity: Number(data.userResources.bufferCapacity),
                autoFillThresholdPercent: Number(
                    data.userResources.autoFillThresholdPercent,
                ),
            };
        },
    });
};
