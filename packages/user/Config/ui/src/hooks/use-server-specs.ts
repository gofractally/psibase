import { useQuery } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

type RawServerSpecs = {
    netBps: number;
    storageBytes: number;
    recommendedMinMemoryBytes: number;
};

export type ServerSpecs = {
    bandwidthBps: number;
    storageBytes: number;
    recommendedMinMemoryBytes: number;
};

type ServerSpecsResponse = {
    getServerSpecs: RawServerSpecs;
};

export const useServerSpecs = () =>
    useQuery({
        queryKey: QueryKey.chainId(),
        queryFn: async (): Promise<ServerSpecs> => {
            const query = `
                query {
                    getServerSpecs {
                        netBps
                        storageBytes
                        recommendedMinMemoryBytes
                    }
                }
            `;

            const url = siblingUrl(null, "virtual-server", "/graphql");

            const res = await graphql<ServerSpecsResponse>(query, url);

            const specs = res.getServerSpecs;

            return {
                bandwidthBps: specs.netBps,
                storageBytes: specs.storageBytes,
                recommendedMinMemoryBytes: specs.recommendedMinMemoryBytes,
            };
        },
    });

