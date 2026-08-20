import { useEffect, useMemo, useState } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { InvoiceQrDialog } from "@/components/invoice-qr-dialog";
import { useRequests } from "@/hooks/use-banx-data";
import { useCreateRequest } from "@/hooks/use-banx-mutations";
import {
    amountFieldValidator,
    existingAccountValidators,
    useAppForm,
} from "@/lib/form";
import {
    REQUEST_INVOICE,
    REQUEST_PLEASE_BOOK,
    REQUEST_SETTLE_AUTH,
    type Asset,
    type PayRequest,
} from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type RequestPrefill = {
    kind?: number;
    counterparty?: string;
    assetId?: number;
    /** Human decimal. */
    amount?: string;
};

function isKnownKind(kind: number | undefined): kind is number {
    return (
        kind === REQUEST_INVOICE ||
        kind === REQUEST_PLEASE_BOOK ||
        kind === REQUEST_SETTLE_AUTH
    );
}

function kindHelp(kind: number, lockedParty?: string): string {
    if (kind === REQUEST_PLEASE_BOOK) {
        return lockedParty
            ? `Ask ${lockedParty} to book a deposit from you (they received value off-graph). Only they can book it.`
            : "Ask someone to book a deposit from you (they received value off-graph). Only they can book it.";
    }
    if (kind === REQUEST_SETTLE_AUTH) {
        return lockedParty
            ? `Authorize ${lockedParty} to record a repayment of what they already owe you. This only shrinks that debt — it is not a path payment, and they cannot go past zero.`
            : "Authorize a debtor to record a repayment of what they already owe you. This only shrinks that debt — it is not a path payment, and they cannot go past zero.";
    }
    return lockedParty
        ? `Ask ${lockedParty} to path-pay you. Last hop must be you.`
        : "Ask someone to path-pay you. Last hop must be you. Leave payer empty so anyone with a path can pay.";
}

function partyLabel(kind: number): string {
    if (kind === REQUEST_PLEASE_BOOK) return "Creditor";
    if (kind === REQUEST_SETTLE_AUTH) return "Debtor";
    return "Payer (optional)";
}

/**
 * Post an invoice, please-book, or settle-auth. Same form from Requests
 * Plus and from an Accounts row (row omits the party field).
 */
export function RequestDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
    prefill,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
    prefill?: RequestPrefill | null;
}) {
    const create = useCreateRequest();
    const { data: user } = useCurrentUser();
    const { data: requests = [] } = useRequests();
    const [qrInvoice, setQrInvoice] = useState<PayRequest | null>(null);
    const [awaitingQrAfterId, setAwaitingQrAfterId] = useState<number | null>(
        null,
    );

    const lockParty = !!prefill?.counterparty?.trim();

    const form = useAppForm({
        defaultValues: {
            kind: REQUEST_PLEASE_BOOK,
            counterparty: "",
            assetId: undefined as number | undefined,
            amount: "",
            memo: "",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            const named = value.counterparty.trim();
            if (value.assetId === undefined) return;
            if (value.kind !== REQUEST_INVOICE && !named) return;
            await new Promise<void>((resolve, reject) => {
                create.mutate(
                    {
                        kind: value.kind,
                        counterparty: named || "0",
                        assetId: value.assetId!,
                        amount: value.amount.trim(),
                        memo: value.memo.trim(),
                        expiresAtSeconds: value.expiresAtSeconds,
                    },
                    {
                        onSuccess: () => {
                            if (value.kind === REQUEST_INVOICE) {
                                const maxId = requests
                                    .filter((r) => r.poster === user)
                                    .reduce((m, r) => Math.max(m, r.id), 0);
                                setAwaitingQrAfterId(maxId);
                            } else {
                                onOpenChange(false);
                            }
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    useEffect(() => {
        if (!open) {
            setAwaitingQrAfterId(null);
            return;
        }
        form.reset({
            kind: isKnownKind(prefill?.kind)
                ? prefill!.kind
                : REQUEST_PLEASE_BOOK,
            counterparty: prefill?.counterparty?.trim() ?? "",
            assetId: prefill?.assetId,
            amount: prefill?.amount?.trim() || "",
            memo: "",
            expiresAtSeconds: 0,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, prefill]);

    const myInvoices = useMemo(
        () =>
            requests.filter(
                (r) => r.poster === user && r.kind === REQUEST_INVOICE,
            ),
        [requests, user],
    );

    useEffect(() => {
        if (awaitingQrAfterId === null) return;
        const newer = myInvoices
            .filter((r) => r.id > awaitingQrAfterId)
            .sort((a, b) => b.id - a.id)[0];
        if (!newer) return;
        setQrInvoice(newer);
        setAwaitingQrAfterId(null);
        onOpenChange(false);
    }, [myInvoices, awaitingQrAfterId, onOpenChange]);

    const waitingForQr = awaitingQrAfterId !== null;
    const symbolOf = (id: number) =>
        assets.find((a) => a.id === id)?.symbol.toUpperCase() ?? `#${id}`;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New request</DialogTitle>
                        <DialogDescription className="sr-only">
                            Post an invoice, deposit request, or settle-auth.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                    >
                        <form.AppField
                            name="kind"
                            children={(field) => (
                                <div className="grid gap-1">
                                    <span className="text-sm font-medium">
                                        Kind
                                    </span>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={
                                                field.state.value ===
                                                REQUEST_PLEASE_BOOK
                                                    ? "default"
                                                    : "outline"
                                            }
                                            onClick={() =>
                                                field.handleChange(
                                                    REQUEST_PLEASE_BOOK,
                                                )
                                            }
                                        >
                                            Deposit request
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={
                                                field.state.value ===
                                                REQUEST_INVOICE
                                                    ? "default"
                                                    : "outline"
                                            }
                                            onClick={() =>
                                                field.handleChange(
                                                    REQUEST_INVOICE,
                                                )
                                            }
                                        >
                                            Invoice
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={
                                                field.state.value ===
                                                REQUEST_SETTLE_AUTH
                                                    ? "default"
                                                    : "outline"
                                            }
                                            onClick={() =>
                                                field.handleChange(
                                                    REQUEST_SETTLE_AUTH,
                                                )
                                            }
                                        >
                                            Settle auth
                                        </Button>
                                    </div>
                                    <p className="text-muted-foreground text-xs">
                                        {kindHelp(
                                            field.state.value,
                                            lockParty
                                                ? prefill?.counterparty?.trim()
                                                : undefined,
                                        )}
                                    </p>
                                </div>
                            )}
                        />
                        {lockParty ? null : (
                            <form.Subscribe
                                selector={(s) => s.values.kind}
                                children={(kind) => (
                                    <form.AppField
                                        name="counterparty"
                                        validators={existingAccountValidators({
                                            optional:
                                                kind === REQUEST_INVOICE,
                                        })}
                                        children={(field) => (
                                            <field.TextField
                                                label={partyLabel(kind)}
                                                placeholder="account"
                                                required={
                                                    kind !== REQUEST_INVOICE
                                                }
                                            />
                                        )}
                                    />
                                )}
                            />
                        )}
                        <form.Field
                            name="assetId"
                            children={(field) => (
                                <AssetField
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                        <form.Subscribe
                            selector={(s) => s.values.assetId}
                            children={(assetId) => (
                                <form.AppField
                                    name="amount"
                                    validators={
                                        assetId !== undefined
                                            ? {
                                                  onChange:
                                                      amountFieldValidator(
                                                          precisionOf(assetId),
                                                          {
                                                              allowEmpty: true,
                                                              allowZero: false,
                                                          },
                                                      ),
                                                  onSubmit:
                                                      amountFieldValidator(
                                                          precisionOf(assetId),
                                                          {
                                                              allowEmpty: false,
                                                              allowZero: false,
                                                          },
                                                      ),
                                              }
                                            : undefined
                                    }
                                    children={(field) => (
                                        <field.TextField
                                            label="Amount"
                                            inputMode="decimal"
                                        />
                                    )}
                                />
                            )}
                        />
                        <form.AppField
                            name="memo"
                            children={(field) => (
                                <field.TextField
                                    label="Memo"
                                    placeholder="what this is for"
                                />
                            )}
                        />
                        <form.Field
                            name="expiresAtSeconds"
                            children={(field) => (
                                <ExpiresField
                                    value={field.state.value}
                                    onChange={(v) => field.handleChange(v)}
                                />
                            )}
                        />
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <form.Subscribe
                                selector={(s) => s.values}
                                children={(values) => {
                                    const named = values.counterparty.trim();
                                    const needParty =
                                        values.kind !== REQUEST_INVOICE &&
                                        !named;
                                    const needAmount = !values.amount.trim();
                                    return (
                                        <form.AppForm>
                                            <form.SubmitButton
                                                labels={[
                                                    "Post request",
                                                    waitingForQr
                                                        ? "Posted…"
                                                        : "Posting…",
                                                ]}
                                                loading={
                                                    create.isPending ||
                                                    waitingForQr
                                                }
                                                disabled={
                                                    values.assetId ===
                                                        undefined ||
                                                    needParty ||
                                                    needAmount
                                                }
                                            />
                                        </form.AppForm>
                                    );
                                }}
                            />
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <InvoiceQrDialog
                open={qrInvoice !== null}
                onOpenChange={(qrOpen) => {
                    if (!qrOpen) setQrInvoice(null);
                }}
                request={qrInvoice}
                symbol={qrInvoice ? symbolOf(qrInvoice.assetId) : ""}
            />
        </>
    );
}
