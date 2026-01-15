import { useQuery } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

interface ServerSpecs {
    netBps: number;
    storageBytes: number;
    minMemoryBytes: number;
}

interface ServerSpecsResponse {
    getServerSpecs: ServerSpecs;
}

export const useServerSpecs = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServer(), "serverSpecs"],
        queryFn: async () => {
            const query = `
                query {
                    getServerSpecs {
                        netBps
                        storageBytes
                        minMemoryBytes
                    }
                }
            `;

            const res = await graphql<ServerSpecsResponse>(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );

            return res.getServerSpecs;
        },
    });
};

