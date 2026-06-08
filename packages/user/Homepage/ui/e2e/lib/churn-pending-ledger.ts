import type { PartyActor } from "./random-three-party-churn";

export type PendingChannel = "dm" | "group";

export type PendingLedgerEntry = {
    body: string;
    from: PartyActor;
    to: PartyActor;
    channel: PendingChannel;
};

export type PendingLedger = {
    record: (entry: PendingLedgerEntry) => void;
    forRecipient: (who: PartyActor) => readonly PendingLedgerEntry[];
    remove: (entry: PendingLedgerEntry) => void;
    clear: () => void;
};

export function createPendingLedger(): PendingLedger {
    const entries: PendingLedgerEntry[] = [];

    return {
        record(entry) {
            entries.push({ ...entry });
        },
        forRecipient(who) {
            return entries.filter((e) => e.to === who);
        },
        remove(entry) {
            const ix = entries.findIndex(
                (e) =>
                    e.body === entry.body &&
                    e.from === entry.from &&
                    e.to === entry.to &&
                    e.channel === entry.channel,
            );
            if (ix >= 0) entries.splice(ix, 1);
        },
        clear() {
            entries.length = 0;
        },
    };
}
