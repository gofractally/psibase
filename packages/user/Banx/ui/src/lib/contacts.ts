import type { LocalContact } from "@shared/hooks/use-contacts";

/** Chain "empty" accounts serialize as `""` or `"0"`. */
export function isNamedAccount(
    account: string | undefined | null,
): account is string {
    const t = account?.trim();
    return !!t && t !== "0";
}

export function inviteClaimedBy(row: {
    claimedBy?: string;
}): string | undefined {
    return isNamedAccount(row.claimedBy) ? row.claimedBy.trim() : undefined;
}

export function contactNickname(
    contacts: LocalContact[] | undefined,
    account: string,
): string | undefined {
    const nick = contacts
        ?.find((c) => c.account === account)
        ?.nickname?.trim();
    return nick || undefined;
}

export function displayAccount(
    contacts: LocalContact[] | undefined,
    account: string,
): string {
    if (!isNamedAccount(account)) return account;
    return contactNickname(contacts, account) ?? account;
}

export function isSavedContact(
    contacts: LocalContact[] | undefined,
    account: string,
): boolean {
    return !!contacts?.some((c) => c.account === account);
}
