import { chainMailConfig } from "./apps/chainmail";
import { contactsConfig } from "./apps/contacts";
import { premAccountsConfig } from "./apps/prem-accounts";
import { tokenSwapConfig } from "./apps/token-swap";
import { tokensConfig } from "./apps/tokens";

export type { AppConfig } from "./app-config";
export { defineAppConfig, getAppPath } from "./app-config";

export const configuredApps = [
    tokensConfig,
    tokenSwapConfig,
    chainMailConfig,
    contactsConfig,
    premAccountsConfig,
];
