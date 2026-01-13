import { useQuery } from "@tanstack/react-query";

import { graphql } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";

interface UserResourcesResponse {
    userResources: {
        balanceRaw: string | number;
        bufferCapacityRaw: string | number;
    };
}

export interface UserResources {
    balanceRaw: number;
    bufferCapacityRaw: number;
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
                        }
                    }
                `;

                const response = await graphql<UserResourcesResponse>(
                    query,
                    zAccount.parse("virtual-server"),
                );

                if (!response.userResources) {
                    return null;
                }
                return {
                    balanceRaw: 50,
                    bufferCapacityRaw: 100,
                };

                // return {
                //     balanceRaw: Number(response.userResources.balanceRaw),
                //     bufferCapacityRaw: Number(
                //         response.userResources.bufferCapacityRaw,
                //     ),
                // };
            } catch (error) {
                console.error("Error fetching user resources:", error);
                return null;
            }
        },
    });
};
