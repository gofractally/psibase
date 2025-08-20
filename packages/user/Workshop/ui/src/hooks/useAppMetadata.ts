import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { Account } from "@/lib/zodTypes";

import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

export const Status = z.enum(["draft", "published", "unpublished"]);

export const MetadataResponse = z.object({
    appMetadata: z
        .object({
            accountId: z.string(),
            name: z.string(),
            shortDesc: z.string(),
            longDesc: z.string(),
            icon: z.string(),
            iconMimeType: z.string(),
            tosSubpage: z.string(),
            privacyPolicySubpage: z.string(),
            appHomepageSubpage: z.string(),
            status: z.string(),
            createdAt: z.string(),
            tags: z.array(z.string()),
        })
        .or(z.null()),
});

export const appMetadataQueryKey = (appName: string | undefined | null) => [
    "appMetadata",
    appName,
];

export const fetchMetadata = async (account: string) => {
    const appName = Account.parse(account);
    try {
        const res = await graphql(
            `
        {
          appMetadata(accountId: "${appName}") {
            accountId
            name
            shortDesc
            longDesc
            icon
            iconMimeType
            tosSubpage
            privacyPolicySubpage
            appHomepageSubpage
            status
            createdAt
            tags
          }
        }
      `,
            siblingUrl(null, "registry", "graphql"),
        );

        const parsed = MetadataResponse.parse(res);
        return parsed.appMetadata;
    } catch (e) {
        if (e instanceof Error) {
            if (e.message.includes("App metadata not found")) {
                return null;
            } else {
                throw e;
            }
        } else {
            throw new Error(`Unrecognised error`);
        }
    }
};

export const useAppMetadata = (appName: string | undefined | null) =>
    useQuery({
        queryKey: appMetadataQueryKey(appName),
        enabled: !!appName,
        queryFn: async () => {
            return fetchMetadata(Account.parse(appName));
        },
    });
