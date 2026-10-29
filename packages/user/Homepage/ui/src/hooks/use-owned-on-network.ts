import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import {
    packages,
    setcode,
    sites,
    usePluginFunctionQuery,
} from "@shared/lib/plugins";
import { zInstalledPackage } from "@shared/lib/schemas/installed-package";

const zCodeResponse = z.object({
    code: z
        .object({
            codeHash: z.string(),
            vmType: z.number(),
            vmVersion: z.number(),
        })
        .nullable(),
});

const zSiteResponse = z.object({
    getConfig: z.object({ account: z.string() }).nullable(),
});

export const useInstalledPackagesWithOwners = () =>
    usePluginFunctionQuery(packages.queries.getInstalled, [], {
        select: (data) => zInstalledPackage.array().parse(data),
        staleTime: 5 * 60_000,
    });

/** The WASM deployed on `account`, or `null` if it isn't a service. */
export const useServiceCode = (account: string | null | undefined) =>
    useQuery({
        queryKey: QueryKey.serviceCode(account),
        queryFn: async () => {
            const res = zCodeResponse.parse(
                await graphqlAuth(
                    setcode.authorized.graphql,
                    `{ code(account: ${JSON.stringify(account)}) { codeHash vmType vmVersion } }`,
                ),
            );
            return res.code;
        },
        enabled: !!account,
    });

/** Whether `account` hosts a site, as `null` when it doesn't. */
export const useSiteConfig = (account: string | null | undefined) =>
    useQuery({
        queryKey: QueryKey.siteConfig(account),
        queryFn: async () => {
            const res = zSiteResponse.parse(
                await graphqlAuth(
                    sites.authorized.graphql,
                    `{ getConfig(account: ${JSON.stringify(account)}) { account } }`,
                ),
            );
            return res.getConfig;
        },
        enabled: !!account,
    });
