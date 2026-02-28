import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

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
                    userResources(user: "${user}") {
                        balance
                        bufferCapacity
                        autoFillThresholdPercent
                    }
                }
            `;

            const result = await supervisor.functionCall({
                service: "virtual-server",
                plugin: "plugin",
                intf: "authorized",
                method: "graphql",
                params: [query],
            });

            const response = JSON.parse(result) as {
                data: UserResourcesResponse;
                errors?: Array<{ message: string }>;
            };

            if (response.errors) {
                throw new Error(response.errors[0].message);
            }

            if (!response.data.userResources) {
                return null;
            }

            return {
                balance: Number(response.data.userResources.balance),
                bufferCapacity: Number(
                    response.data.userResources.bufferCapacity,
                ),
                autoFillThresholdPercent: Number(
                    response.data.userResources.autoFillThresholdPercent,
                ),
            };
        },
    });
};
