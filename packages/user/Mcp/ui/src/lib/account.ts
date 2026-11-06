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

/** Setup-form errors for managed + agent names (format + distinct). */
export function setupNameErrors(
    managedRaw: string,
    agentRaw: string,
): { managed: string | null; agent: string | null; form: string | null } {
    const managed = managedRaw.trim();
    const agent = agentRaw.trim();
    const managedErr = accountNameError(managedRaw);
    const agentErr = accountNameError(agentRaw);
    let form: string | null = null;
    if (!managedErr && !agentErr && managed === agent) {
        form = "Managed and agent names must differ";
    }
    return { managed: managedErr, agent: agentErr, form };
}

export function setupNamesValid(managedRaw: string, agentRaw: string): boolean {
    const e = setupNameErrors(managedRaw, agentRaw);
    return !e.managed && !e.agent && !e.form;
}
