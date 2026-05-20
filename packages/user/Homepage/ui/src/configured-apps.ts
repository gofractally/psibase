import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

import { chainMailConfig } from "./apps/chainmail";
import { chatConfig } from "./apps/chat";
import { contactsConfig } from "./apps/contacts";
import { tokenSwapConfig } from "./apps/token-swap";
import { tokensConfig } from "./apps/tokens";

export const AppConfig = z.object({
    service: zAccount,
    name: z.string(),
    isMore: z.boolean(),
    element: z.any().optional(),
    icon: z.any(),
    description: z.string(),
    isLoginRequired: z.boolean(),
    showLoginLoadingSpinner: z.boolean(),
    href: z.string().url().optional(),
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
    tokenSwapConfig,
    chainMailConfig,
    contactsConfig,
    chatConfig,
].map((config) => AppConfig.parse(config));
