import { Check, LifeBuoy, Search, ShieldCheck, X } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { PageHeader, Panel } from "@/components/page-header";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";

import type { PartnerAccount, PartnerDecision, PartnerKey } from "./api";
import {
    usePartnerAccounts,
    usePartnerDecision,
    usePartnerRequests,
} from "./hooks";

const when = (iso?: string | null) =>
    iso
        ? new Date(iso).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
          })
        : "";

const duration = (seconds: number) =>
    seconds % 86400 === 0
        ? `${seconds / 86400} d`
        : `${Math.round(seconds / 3600)} h`;

/** Enough of a key to compare with one read out over another channel. */
const fingerprint = (key: PartnerKey) => {
    const text = key.key.replace(/-----[A-Z ]+-----|\s+/g, "");
    return `${text.slice(-12, -6)} ${text.slice(-6)}`;
};

const StateBadge = ({ account }: { account: PartnerAccount }) =>
    account.state === "frozen" ? (
        <Badge variant="destructive">Frozen</Badge>
    ) : account.state === "paused" ? (
        <Badge variant="secondary">Paused</Badge>
    ) : (
        <Badge variant="outline">In use</Badge>
    );

/** What the account is asking for, in a sentence. */
const describe = (account: PartnerAccount): string => {
    const pending = account.pending;
    if (account.state === "frozen") {
        return account.recoveryRequests.length
            ? "Frozen. New keys were proposed; releasing it installs them."
            : "Frozen. No new keys have been proposed yet.";
    }
    if (!pending) {
        return `Paused until ${when(account.stateUntil)}. You can end the pause early.`;
    }
    const ends = `Takes effect by itself ${when(account.stateUntil)}.`;
    if (pending.kind === "ownerKeys") {
        return `Wants to replace its owner key (new key ends ${pending.owner ? fingerprint(pending.owner) : "?"}). ${ends}`;
    }
    if (pending.kind === "partner") {
        return `Wants ${pending.partner || "nobody"} as its recovery partner instead of you. ${ends}`;
    }
    return `Wants a pause of ${duration(pending.pauseSeconds ?? 0)} and a freeze window of ${duration(pending.freezeSeconds ?? 0)}. ${ends}`;
};

const Decide = ({
    approve,
    reject,
    approveLabel = "Approve",
    rejectLabel = "Reject",
    busy,
    send,
}: {
    approve: PartnerDecision;
    reject?: PartnerDecision;
    approveLabel?: string;
    rejectLabel?: string;
    busy: boolean;
    send: (decision: PartnerDecision) => void;
}) => (
    <div className="flex shrink-0 items-center gap-2">
        {reject && (
            <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => send(reject)}
            >
                <X />
                {rejectLabel}
            </Button>
        )}
        <Button size="sm" disabled={busy} onClick={() => send(approve)}>
            <Check />
            {approveLabel}
        </Button>
    </div>
);

const RequestRow = ({ account }: { account: PartnerAccount }) => {
    const { mutate: send, isPending: busy } = usePartnerDecision();
    const name = account.account;
    return (
        <li className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-64">
                    <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{name}</span>
                        <StateBadge account={account} />
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                        {describe(account)}
                    </p>
                </div>
                {account.state === "paused" &&
                    (account.pending ? (
                        <Decide
                            approve={{ kind: "confirm", account: name }}
                            reject={{ kind: "reject", account: name }}
                            busy={busy}
                            send={send}
                        />
                    ) : (
                        <Decide
                            approve={{ kind: "endPause", account: name }}
                            approveLabel="End pause"
                            busy={busy}
                            send={send}
                        />
                    ))}
            </div>
            {account.state === "frozen" &&
                account.recoveryRequests.map((request) => (
                    <div
                        key={request.id}
                        className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2"
                    >
                        <div className="min-w-0 text-sm">
                            <div>
                                Request {request.id} · {when(request.time)}
                            </div>
                            <div className="text-muted-foreground font-mono text-xs">
                                owner key ends {fingerprint(request.owner)} ·
                                active key ends {fingerprint(request.active)}
                            </div>
                        </div>
                        <Decide
                            approve={{
                                kind: "unfreeze",
                                account: name,
                                requestId: request.id,
                            }}
                            reject={{
                                kind: "rejectRecovery",
                                account: name,
                                requestId: request.id,
                            }}
                            approveLabel="Release with these keys"
                            busy={busy}
                            send={send}
                        />
                    </div>
                ))}
        </li>
    );
};

const Requests = () => {
    const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
        usePartnerRequests();
    const accounts = data?.pages.flatMap((page) => page.accounts) ?? [];
    return (
        <Panel
            title="Waiting for you"
            description="Approve only when you are sure the request comes from the account's real owner. Ask them over a channel you already trust."
        >
            {isPending ? (
                <Loading />
            ) : accounts.length === 0 ? (
                <EmptyState icon={ShieldCheck}>
                    Nothing is waiting for your decision.
                </EmptyState>
            ) : (
                <ul className="divide-y">
                    {accounts.map((account) => (
                        <RequestRow key={account.account} account={account} />
                    ))}
                </ul>
            )}
            {hasNextPage && (
                <div className="border-t p-2 text-center">
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={isFetchingNextPage}
                        onClick={() => void fetchNextPage()}
                    >
                        Show more
                    </Button>
                </div>
            )}
        </Panel>
    );
};

const Accounts = () => {
    const [search, setSearch] = useState("");
    const prefix = useDeferredValue(
        search
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, ""),
    );
    const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
        usePartnerAccounts(prefix);
    const accounts = data?.pages.flatMap((page) => page.accounts) ?? [];
    return (
        <Panel
            title="Accounts you can recover"
            description="You are the recovery partner of these accounts."
            actions={
                <div className="relative">
                    <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Jump to a name"
                        className="h-8 w-48 pl-8"
                    />
                </div>
            }
        >
            {isPending ? (
                <Loading />
            ) : accounts.length === 0 ? (
                <EmptyState icon={LifeBuoy}>
                    {prefix
                        ? `No account starting with “${prefix}”.`
                        : "No accounts yet."}
                </EmptyState>
            ) : (
                <ul className="divide-y">
                    {accounts.map((account) => (
                        <li
                            key={account.account}
                            className="flex items-center justify-between gap-3 px-4 py-2.5"
                        >
                            <span className="truncate font-medium">
                                {account.account}
                            </span>
                            <span className="flex items-center gap-3">
                                {account.state !== "normal" && (
                                    <span className="text-muted-foreground text-xs">
                                        until {when(account.stateUntil) || "released"}
                                    </span>
                                )}
                                <StateBadge account={account} />
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-xs">
                <span>
                    {accounts.length} shown
                    {hasNextPage ? ", more below" : ""}
                </span>
                {hasNextPage && (
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={isFetchingNextPage}
                        onClick={() => void fetchNextPage()}
                    >
                        Show more
                    </Button>
                )}
            </div>
        </Panel>
    );
};

export const RecoveryPage = () => (
    <div className="flex flex-col gap-4">
        <PageHeader
            title="Recovery"
            description="Accounts that named you as their recovery partner. You can approve a change of their keys or partner right away, end a pause, and release a frozen account with new keys."
        />
        <Requests />
        <Accounts />
    </div>
);
