import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Plus, QrCode } from "lucide-react";

import { formatExpiresAt } from "@/components/expires-at-picker";
import { InvoiceQrDialog } from "@/components/invoice-qr-dialog";
import { PageHeader } from "@/components/page-header";
import { RequestDialog } from "@/components/request-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import { useRequests } from "@/hooks/use-banx-data";
import { useCancelRequest, useDeposit } from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import {
    REQUEST_INVOICE,
    REQUEST_PLEASE_BOOK,
    type PayRequest,
} from "@/lib/graphql";
import { invoicePaySearch } from "@/lib/invoice-url";

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
    if (kind === REQUEST_PLEASE_BOOK) return "Deposit request";
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
    const cancel = useCancelRequest();
    const deposit = useDeposit();
    const navigate = useNavigate();
    const nowSec = Math.floor(Date.now() / 1000);
    const [bookingId, setBookingId] = useState<number | null>(null);
    const [qrInvoice, setQrInvoice] = useState<PayRequest | null>(null);
    const [createOpen, setCreateOpen] = useState(false);

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

    const fulfillInvoice = (r: PayRequest) => {
        navigate(`/accounts?${invoicePaySearch(r).toString()}`);
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
                                        : !r.counterparty ||
                                            r.counterparty === "0"
                                          ? "Anyone"
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
                                    {role === "out" &&
                                    r.kind === REQUEST_INVOICE ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="mr-1"
                                            onClick={() => setQrInvoice(r)}
                                        >
                                            <QrCode className="mr-1 size-4" />
                                            QR
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
                description="Invoices ask someone to path-pay you (they do not clear an existing loan). A deposit request asks them to book value they received off-graph — only they can book it."
                action={
                    <Button
                        type="button"
                        size="icon"
                        className="size-9 shrink-0 rounded-full"
                        aria-label="New request"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus className="size-5" />
                    </Button>
                }
            />

            <RequestDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                assets={assets}
                precisionOf={precisionOf}
            />

            <section className="space-y-3">
                <h2 className="font-medium">Incoming</h2>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : (
                    renderRows(
                        incoming,
                        "in",
                        "None — invoices to path-pay or deposits to book.",
                    )
                )}
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">You posted</h2>
                {renderRows(outgoing, "out", "No open requests.")}
            </section>

            <InvoiceQrDialog
                open={qrInvoice !== null}
                onOpenChange={(open) => {
                    if (!open) setQrInvoice(null);
                }}
                request={qrInvoice}
                symbol={
                    qrInvoice ? symbolOf(qrInvoice.assetId) : ""
                }
            />
        </div>
    );
}
