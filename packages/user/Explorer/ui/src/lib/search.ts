import { blockNumFromId, isAccountName, isHash } from "./format";
import {
    fetchAccount,
    fetchAccountsWithKey,
    fetchBlockSummary,
    findTransaction,
} from "./queries";
import { FIRST_VISIBLE_BLOCK } from "./types";

export type SearchKind =
    | "block-number"
    | "hash"
    | "public-key"
    | "account"
    | "text";

export const classify = (raw: string): { kind: SearchKind; term: string } => {
    const term = raw.trim();
    if (/^#?\d+$/.test(term)) {
        return { kind: "block-number", term: term.replace(/^#/, "") };
    }
    const hex = term.replace(/^0x/i, "");
    if (isHash(hex)) return { kind: "hash", term: hex.toUpperCase() };
    if (/^PUB_/.test(term) || /^-----BEGIN/.test(term)) {
        return { kind: "public-key", term };
    }
    if (isAccountName(term)) return { kind: "account", term };
    return { kind: "text", term };
};

export type SearchResolution =
    | { type: "navigate"; to: string }
    | { type: "accounts"; accounts: string[]; term: string }
    | { type: "not-found"; term: string; kind: SearchKind }
    | { type: "error"; term: string; kind: SearchKind; message: string };

export const resolveSearch = async (raw: string): Promise<SearchResolution> => {
    const { kind, term } = classify(raw);

    if (kind === "block-number") {
        const num = Number(term);
        if (num < FIRST_VISIBLE_BLOCK) {
            return { type: "navigate", to: `/blocks/${FIRST_VISIBLE_BLOCK}` };
        }
        return { type: "navigate", to: `/blocks/${num}` };
    }

    if (kind === "hash") {
        const num = blockNumFromId(term);
        if (num !== null && num >= FIRST_VISIBLE_BLOCK) {
            try {
                const block = await fetchBlockSummary(num);
                if (block && block.id.toUpperCase() === term) {
                    return { type: "navigate", to: `/blocks/${num}` };
                }
            } catch {
                /* fall through to transaction lookup */
            }
        }
        const trx = await findTransaction(term);
        if (trx) return { type: "navigate", to: `/tx/${term}` };
        return { type: "not-found", term, kind };
    }

    if (kind === "public-key") {
        try {
            const records = await fetchAccountsWithKey(term);
            if (records.length === 1) {
                return {
                    type: "navigate",
                    to: `/accounts/${records[0].account}`,
                };
            }
            return {
                type: "accounts",
                accounts: records.map((r) => r.account),
                term,
            };
        } catch {
            return { type: "not-found", term, kind };
        }
    }

    if (kind === "account") {
        try {
            const account = await fetchAccount(term);
            if (account) return { type: "navigate", to: `/accounts/${term}` };
            return { type: "not-found", term, kind };
        } catch (e) {
            // Don't claim the account is missing when we simply couldn't ask.
            return {
                type: "error",
                term,
                kind,
                message: e instanceof Error ? e.message : String(e),
            };
        }
    }

    return { type: "not-found", term, kind };
};
