/** Result of attempting to accept an inbound chat message for display + ack. */
export type InboundMessageAcceptance =
    | "accepted"
    | "deferred_contacts"
    | "rejected";

/** Whether an inbound peer message can be shown and acked now. */
export function inboundMessageAcceptance(
    self: string | null | undefined,
    from: string,
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): InboundMessageAcceptance {
    if (!self || from === self) return "rejected";
    if (!contactsLoaded) return "deferred_contacts";
    if (!contactAccounts.has(from)) return "rejected";
    return "accepted";
}
