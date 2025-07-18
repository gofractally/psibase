import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account, Metadata } from "@/lib/zodTypes";

export const Status = z.enum(["draft", "published", "unpublished"]);

export const MetadataResponse = z.object({
    appMetadata: Metadata,
    extraMetadata: z.object({
        createdAt: z.string(),
        status: Status,
    }),
});

export const appMetadataQueryKey = (appName: string | undefined | null) => [
    "appMetadata",
    appName,
];

export const fetchMetadata = async (account: string) => {
    const appName = Account.parse(account);
    try {
        const res = await supervisor.functionCall({
            method: "getAppMetadata",
            params: [appName],
            service: "registry",
            intf: "consumer",
        });
        return MetadataResponse.parse(res);
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
