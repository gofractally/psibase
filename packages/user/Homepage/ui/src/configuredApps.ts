import { z } from "zod";

import { chainMailConfig } from "./apps/chainmail";
import { contactsConfig } from "./apps/contacts";
import { tokensConfig } from "./apps/tokens";
import { zAccount } from "./lib/zod/Account";

export const AppConfig = z.object({
    service: zAccount,
    name: z.string(),
    isMore: z.boolean(),
    element: z.any().optional(),
    icon: z.any(),
    description: z.string(),
    isLoginRequired: z.boolean(),
    showLoginLoadingSpinner: z.boolean(),
    children: z.array(
        z.object({
            path: z.string(),
            element: z.any(),
            name: z.string(),
            icon: z.any().optional(),
            isLoginRequired: z.boolean().optional(),
        }),
    ),
});

export type AppConfigType = z.infer<typeof AppConfig>;

export const configuredApps: AppConfigType[] = [
    tokensConfig,
    chainMailConfig,
    contactsConfig,
].map((config) => AppConfig.parse(config));
