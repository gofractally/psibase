import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
    zAccount,
} from "@shared/lib/schemas/account";

export { MAX_ACCOUNT_NAME_LENGTH, MIN_ACCOUNT_NAME_LENGTH, zAccount };

/** First validation error for a proposed account name, or null if valid. */
export function accountNameError(raw: string): string | null {
    const value = raw.trim();
    if (!value) return "Enter an account name";
    const result = zAccount.safeParse(value);
    if (result.success) return null;
    return result.error.issues[0]?.message ?? "Invalid account name";
}

/**
 * Setup-form errors for the agent name. The owner is the logged-in account
 * (the sender on the agent's staged txs); owner and agent must differ.
 */
export function setupNameErrors(
    agentRaw: string,
    owner: string,
): { agent: string | null; form: string | null } {
    const agent = agentRaw.trim();
    const agentErr = accountNameError(agentRaw);
    let form: string | null = null;
    if (!agentErr && owner && agent === owner.trim()) {
        form = "Agent must differ from your (owner) account";
    }
    return { agent: agentErr, form };
}

export function setupNamesValid(agentRaw: string, owner: string): boolean {
    const e = setupNameErrors(agentRaw, owner);
    return !e.agent && !e.form;
}
