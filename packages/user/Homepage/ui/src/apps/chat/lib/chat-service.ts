import { zAccount } from "@shared/lib/schemas/account";

/**
 * On-chain Chat account / package name.
 * Mirrors `psibase::services::chat::Wrapper::SERVICE` / account `"chat"`.
 */
export const CHAT_SERVICE = zAccount.parse("chat");

/**
 * Feature-scoped localStorage suffix for the Chat app
 * (`{chat}.{feature}.{schemaVersion}`), before chain scoping.
 */
export function chatAppStorageFeatureKey(
    feature: string,
    schemaVersion = "v1",
): string {
    return `${CHAT_SERVICE}.${feature}.${schemaVersion}`;
}
