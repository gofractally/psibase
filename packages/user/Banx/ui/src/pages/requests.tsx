import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useRequests } from "@/hooks/use-banx-data";
import {
    useCancelRequest,
    useCreateRequest,
    useDeposit,
    useFulfillSettle,
} from "@/hooks/use-banx-mutations";
import { amountPlaceholder, displayAmount } from "@/lib/amount";
import { formatExpiresAt } from "@/components/expires-at-picker";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import {
    REQUEST_INVOICE,
    REQUEST_PLEASE_BOOK,
    REQUEST_SETTLE_AUTH,
    type PayRequest,
} from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

function kindLabel(kind: number): string {
    if (kind === REQUEST_INVOICE) return "Invoice";
    if (kind === REQUEST_PLEASE_BOOK) return "Please book";
    if (kind === REQUEST_SETTLE_AUTH) return "Settle auth";
    return `Kind ${kind}`;
}

function isOpen(r: PayRequest, nowSec: number): boolean {
    const rem = Number(r.remaining);
    const leftover = Number.isFinite(rem)
        ? rem > 0
        : displayAmount(r.remaining) !== "0";
    return leftover && (r.expiresAt === 0 || r.expiresAt >= nowSec);
}

export function RequestsPage() {
    const { data: user } = useCurrentUser();
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const { data: requests = [], isLoading } = useRequests();
    const create = useCreateRequest();
    const cancel = useCancelRequest();
    const deposit = useDeposit();
    const settle = useFulfillSettle();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const nowSec = Math.floor(Date.now() / 1000);
    const [bookingId, setBookingId] = useState<number | null>(null);

    const incoming = useMemo(
        () =>
            requests.filter(
                (r) => r.counterparty === user && isOpen(r, nowSec),
            ),
        [requests, user, nowSec],
    );
    const outgoing = useMemo(
        () => requests.filter((r) => r.poster === user && isOpen(r, nowSec)),
        [requests, user, nowSec],
    );

    const createForm = useAppForm({
        defaultValues: {
            kind: REQUEST_PLEASE_BOOK,
            counterparty: "",
            assetId: undefined as number | undefined,
            amount: "1.00",
            memo: "",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            if (value.assetId === undefined || !value.counterparty.trim())
                return;
            await new Promise<void>((resolve, reject) => {
                create.mutate(
                    {
                        kind: value.kind,
                        counterparty: value.counterparty.trim(),
                        assetId: value.assetId!,
                        amount: value.amount.trim(),
                        memo: value.memo.trim(),
                        expiresAtSeconds: value.expiresAtSeconds,
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    useEffect(() => {
        const kind = Number(searchParams.get("kind") || "");
        const counterparty = searchParams.get("counterparty");
        const assetId = Number(searchParams.get("assetId") || "");
        const amount = searchParams.get("amount");
        if (
            kind === REQUEST_INVOICE ||
            kind === REQUEST_PLEASE_BOOK ||
            kind === REQUEST_SETTLE_AUTH
        ) {
            createForm.setFieldValue("kind", kind);
        }
        if (counterparty) createForm.setFieldValue("counterparty", counterparty);
        if (Number.isFinite(assetId) && assetId > 0) {
            createForm.setFieldValue("assetId", assetId);
        }
        if (amount) createForm.setFieldValue("amount", amount);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const fulfillInvoice = (r: PayRequest) => {
        const q = new URLSearchParams({
            request: String(r.id),
            payee: r.poster,
            toAsset: String(r.assetId),
            amount: displayAmount(r.remaining),
        });
        navigate(`/path-pay?${q.toString()}`);
    };

    const fulfillSettle = async (r: PayRequest) => {
        setBookingId(r.id);
        try {
            await new Promise<void>((resolve, reject) => {
                settle.mutate(
                    {
                        requestId: r.id,
                        assetId: r.assetId,
                        amount: displayAmount(r.remaining),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        } finally {
            setBookingId(null);
        }
    };

    const fulfillBook = async (r: PayRequest) => {
        setBookingId(r.id);
        try {
            await new Promise<void>((resolve, reject) => {
                deposit.mutate(
                    {
                        depositor: r.poster,
                        assetId: r.assetId,
                        amount: displayAmount(r.remaining),
                        interestRatePpm: 0,
                        requestId: r.id,
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        } finally {
            setBookingId(null);
        }
    };

    const renderRows = (
        rows: PayRequest[],
        role: "in" | "out",
        empty: string,
    ) =>
        rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
            <div className="overflow-x-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Kind</TableHead>
                            <TableHead>
                                {role === "in" ? "From" : "To"}
                            </TableHead>
                            <TableHead>Asset</TableHead>
                            <TableHead className="text-right">
                                Remaining
                            </TableHead>
                            <TableHead>Memo</TableHead>
                            <TableHead className="text-right">
                                Expires
                            </TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((r) => (
                            <TableRow key={r.id}>
                                <TableCell>{kindLabel(r.kind)}</TableCell>
                                <TableCell>
                                    {role === "in"
                                        ? r.poster
                                        : r.counterparty}
                                </TableCell>
                                <TableCell>{symbolOf(r.assetId)}</TableCell>
                                <TableCell className="text-right font-mono">
                                    {displayAmount(r.remaining)}
                                </TableCell>
                                <TableCell className="max-w-[12rem] truncate text-sm">
                                    {r.memo || "—"}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                    {formatExpiresAt(r.expiresAt)}
                                </TableCell>
                                <TableCell className="text-right">
                                    {role === "in" &&
                                    r.kind === REQUEST_INVOICE ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => fulfillInvoice(r)}
                                        >
                                            Path-pay
                                        </Button>
                                    ) : null}
                                    {role === "in" &&
                                    r.kind === REQUEST_SETTLE_AUTH ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={bookingId === r.id}
                                            onClick={() =>
                                                void fulfillSettle(r)
                                            }
                                        >
                                            {bookingId === r.id
                                                ? "Settling…"
                                                : "Settle"}
                                        </Button>
                                    ) : null}
                                    {role === "in" &&
                                    r.kind === REQUEST_PLEASE_BOOK ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={bookingId === r.id}
                                            onClick={() => void fulfillBook(r)}
                                        >
                                            {bookingId === r.id
                                                ? "Booking…"
                                                : "Book deposit"}
                                        </Button>
                                    ) : null}
                                    {role === "out" ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => cancel.mutate(r.id)}
                                        >
                                            Cancel
                                        </Button>
                                    ) : null}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        );

    return (
        <div className="space-y-10">
            <PageHeader
                title="Requests"
                description="Invoices ask someone to path-pay you (they do not clear an existing loan). Please-book asks a creditor to record off-graph value they received — only they can book it. Settle-auth lets a debtor pay down a tab you already authorized, capped by what they owe you."
            />

            <section className="grid max-w-xl gap-3 rounded-lg border p-4">
                <h2 className="font-medium">New request</h2>
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void createForm.handleSubmit();
                    }}
                >
                    <createForm.AppField
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
                                        Please book
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
                                            field.handleChange(REQUEST_INVOICE)
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
                                    {field.state.value === REQUEST_PLEASE_BOOK
                                        ? "Ask a creditor to deposit you (they received value off-graph)."
                                        : field.state.value ===
                                            REQUEST_SETTLE_AUTH
                                          ? "You are the creditor. The named debtor may pay down what they owe you, up to this amount."
                                          : "Ask someone to path-pay you. Last hop must be you."}
                                </p>
                            </div>
                        )}
                    />
                    <createForm.AppField
                        name="counterparty"
                        children={(field) => (
                            <field.TextField
                                label={
                                    createForm.state.values.kind ===
                                    REQUEST_PLEASE_BOOK
                                        ? "Creditor"
                                        : createForm.state.values.kind ===
                                            REQUEST_SETTLE_AUTH
                                          ? "Debtor"
                                          : "Payer"
                                }
                                placeholder="account"
                                required
                            />
                        )}
                    />
                    <createForm.Field
                        name="assetId"
                        children={(field) => (
                            <AssetField
                                assets={assets}
                                value={field.state.value}
                                onChange={(id) => field.handleChange(id)}
                            />
                        )}
                    />
                    <createForm.Subscribe
                        selector={(s) => s.values.assetId}
                        children={(assetId) => (
                            <createForm.AppField
                                name="amount"
                                validators={
                                    assetId !== undefined
                                        ? {
                                              onChange: amountFieldValidator(
                                                  precisionOf(assetId),
                                              ),
                                              onSubmit: amountFieldValidator(
                                                  precisionOf(assetId),
                                              ),
                                          }
                                        : undefined
                                }
                                children={(field) => (
                                    <field.TextField
                                        label={
                                            assetId !== undefined
                                                ? `Amount (${amountPlaceholder(precisionOf(assetId))})`
                                                : "Amount"
                                        }
                                        inputMode="decimal"
                                        required
                                    />
                                )}
                            />
                        )}
                    />
                    <createForm.AppField
                        name="memo"
                        children={(field) => (
                            <field.TextField
                                label="Memo"
                                placeholder="what this is for"
                            />
                        )}
                    />
                    <createForm.Field
                        name="expiresAtSeconds"
                        children={(field) => (
                            <ExpiresField
                                value={field.state.value}
                                onChange={(v) => field.handleChange(v)}
                            />
                        )}
                    />
                    <createForm.AppForm>
                        <createForm.SubmitButton
                            labels={["Post request", "Posting…"]}
                            loading={create.isPending}
                        />
                    </createForm.AppForm>
                </form>
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">Incoming</h2>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : (
                    renderRows(
                        incoming,
                        "in",
                        "None — invoices to pay or deposits to book.",
                    )
                )}
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">You posted</h2>
                {renderRows(outgoing, "out", "No open requests.")}
            </section>
        </div>
    );
}
