import { z } from "zod";
import { chainMailConfig } from "./apps/chainmail";
import { tokensConfig } from "./apps/tokens";
import { Account } from "./lib/zod/Account";
import { workshopConfig } from "./apps/workshop";
import { contactsConfig } from "./apps/contacts";

export const AppConfig = z.object({
    service: Account,
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
    workshopConfig,
].map((config) => AppConfig.parse(config));
