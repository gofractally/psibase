import { accountMarketplaceConfig } from "./apps/accounts-marketplace";
import { chainMailConfig } from "./apps/chainmail";
import { contactsConfig } from "./apps/contacts";
import { recoveryConfig } from "./apps/recovery";
import { tokensConfig } from "./apps/tokens";

export const configuredApps = [
    tokensConfig,
    chainMailConfig,
    contactsConfig,
    accountMarketplaceConfig,
    recoveryConfig,
];
