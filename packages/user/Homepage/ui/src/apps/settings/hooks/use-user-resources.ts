import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

interface UserResourcesResponse {
    userResources: {
        balanceRaw: string | number;
        bufferCapacityRaw: string | number;
        bufferCapacity: string | number;
        autoFillThresholdPercent: string | number;
    };
}

export interface UserResources {
    balanceRaw: number;
    bufferCapacityRaw: number;
    bufferCapacity: number;
    autoFillThresholdPercent: number;
}

export const useUserResources = (user: string | null | undefined) => {
    return useQuery<UserResources | null>({
        queryKey: ["userResources", user],
        enabled: !!user,
        queryFn: async () => {
            if (!user) return null;

            try {
                const query = `
                    query {
                        userResources(user: "${user}") {
                            balanceRaw
                            bufferCapacityRaw
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
                    balanceRaw: Number(response.data.userResources.balanceRaw),
                    bufferCapacityRaw: Number(
                        response.data.userResources.bufferCapacityRaw,
                    ),
                    bufferCapacity: Number(
                        response.data.userResources.bufferCapacity,
                    ),
                    autoFillThresholdPercent: Number(
                        response.data.userResources.autoFillThresholdPercent,
                    ),
                };
            } catch (error) {
                console.error("Error fetching user resources:", error);
                return null;
            }
        },
    });
};
