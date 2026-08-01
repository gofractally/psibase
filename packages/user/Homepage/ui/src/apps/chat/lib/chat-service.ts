import { zAccount } from "@shared/lib/schemas/account";

/**
 * On-chain Chat account / package name.
 * Mirrors `psibase::services::chat::Wrapper::SERVICE` / account `"chat"`.
 */
export const CHAT_SERVICE = zAccount.parse("chat");
