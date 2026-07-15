import {
    chainScopedStorageKey,
    readMigratingLocalStorage,
} from "./chat-chain-storage";
import { chatAppStorageFeatureKey } from "./chat-service";

const STORAGE_FEATURE = chatAppStorageFeatureKey("lastOpenChat");
const LEGACY_STORAGE_FEATURE = "pslack.lastOpenChat.v1";

export function lastOpenChatStorageKey(
    chainId: string,
    account: string,
): string {
    return chainScopedStorageKey(chainId, `${STORAGE_FEATURE}.${account}`);
}

export function readLastOpenChatId(
    chainId: string,
    account: string,
): string | undefined {
    try {
        const raw = readMigratingLocalStorage(
            chainId,
            `${STORAGE_FEATURE}.${account}`,
            `${LEGACY_STORAGE_FEATURE}.${account}`,
        );
        if (!raw) return undefined;
        return typeof raw === "string" && raw.length > 0 ? raw : undefined;
    } catch {
        return undefined;
    }
}

export function writeLastOpenChatId(
    chainId: string,
    account: string,
    conversationId: string | undefined,
): void {
    try {
        const key = lastOpenChatStorageKey(chainId, account);
        if (!conversationId) {
            globalThis.localStorage.removeItem(key);
            return;
        }
        globalThis.localStorage.setItem(key, conversationId);
    } catch {
        // ignore quota / private mode
    }
}
