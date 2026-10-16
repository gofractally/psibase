import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Plus, QrCode } from "lucide-react";

import { formatExpiresAt } from "@/components/expires-at-picker";
import { InvoiceQrDialog } from "@/components/invoice-qr-dialog";
import { PageHeader } from "@/components/page-header";
import { PayAuthCollectDialog } from "@/components/pay-auth-collect-dialog";
import { RequestDialog } from "@/components/request-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import { usePayAuths, useRequests } from "@/hooks/use-banx-data";
import {
    useCancelPayAuth,
    useCancelRequest,
    useDeposit,
} from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import {
    REQUEST_INVOICE,
    REQUEST_PLEASE_BOOK,
    type PayAuth,
    type PayRequest,
} from "@/lib/graphql";
import {
    dueCount,
    formatUnix,
    periodLabel,
    seriesEnded,
} from "@/lib/pay-auth";
import { invoicePaySearch } from "@/lib/invoice-url";

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
    const { data: payAuths = [], isLoading: payAuthsLoading } = usePayAuths();
    const cancel = useCancelRequest();
    const cancelPayAuth = useCancelPayAuth();
    const deposit = useDeposit();
    const navigate = useNavigate();
    const nowSec = Math.floor(Date.now() / 1000);
    const [bookingId, setBookingId] = useState<number | null>(null);
    const [qrInvoice, setQrInvoice] = useState<PayRequest | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [collecting, setCollecting] = useState<PayAuth | null>(null);
    const [dropPayAuth, setDropPayAuth] = useState<PayAuth | null>(null);

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
                description="An invoice asks someone to pay you. A deposit request asks them to book value they already received. Only they can book it."
                action={
                    <Button
                        type="button"
                        className="gap-1.5"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus className="size-4" />
                        New request
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
                        "None yet. An invoice asks for a payment. A deposit request asks them to book value they received.",
                    )
                )}
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">You posted</h2>
                {renderRows(outgoing, "out", "No open requests.")}
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">Repeating payments</h2>
                {payAuths.length > 0 ? (
                    <p className="text-muted-foreground text-sm">
                        Collect pays one due period at a time. Cancel deletes
                        the series and does not pay a period that is already
                        due.
                    </p>
                ) : null}
                {payAuthsLoading ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : payAuths.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No repeating payments.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>With</TableHead>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">
                                        Each period
                                    </TableHead>
                                    <TableHead>Every</TableHead>
                                    <TableHead>Next due</TableHead>
                                    <TableHead className="text-right">
                                        Unpaid
                                    </TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {payAuths.map((row) => {
                                    const other =
                                        row.payer === user
                                            ? row.payee
                                            : row.payer;
                                    const unpaid = dueCount(row, nowSec);
                                    const ended = seriesEnded(row);
                                    return (
                                        <TableRow key={row.id}>
                                            <TableCell>{other}</TableCell>
                                            <TableCell>
                                                {symbolOf(row.assetId)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono">
                                                {displayAmount(row.amount)}
                                            </TableCell>
                                            <TableCell>
                                                {periodLabel(row.periodSeconds)}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {ended
                                                    ? "Ended"
                                                    : formatUnix(row.nextDue)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {unpaid}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {unpaid > 0 ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        className="mr-1"
                                                        onClick={() =>
                                                            setCollecting(row)
                                                        }
                                                    >
                                                        Collect
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        if (unpaid > 0) {
                                                            setDropPayAuth(
                                                                row,
                                                            );
                                                            return;
                                                        }
                                                        cancelPayAuth.mutate({
                                                            id: row.id,
                                                            forceCancel: false,
                                                        });
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>

            <PayAuthCollectDialog
                row={collecting}
                nowSec={nowSec}
                symbolOf={symbolOf}
                onOpenChange={(open) => {
                    if (!open) setCollecting(null);
                }}
            />

            <Dialog
                open={dropPayAuth !== null}
                onOpenChange={(open) => {
                    if (!open) setDropPayAuth(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Drop unpaid periods?</DialogTitle>
                        <DialogDescription>
                            {dropPayAuth
                                ? `${dueCount(dropPayAuth, nowSec)} ${
                                      dueCount(dropPayAuth, nowSec) === 1
                                          ? "period is"
                                          : "periods are"
                                  } already due. Deleting does not pay them.`
                                : "Deleting does not pay a due period."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setDropPayAuth(null)}
                        >
                            Keep
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={cancelPayAuth.isPending}
                            onClick={() => {
                                if (!dropPayAuth) return;
                                cancelPayAuth.mutate(
                                    {
                                        id: dropPayAuth.id,
                                        forceCancel: true,
                                    },
                                    {
                                        onSuccess: () => setDropPayAuth(null),
                                    },
                                );
                            }}
                        >
                            Delete without paying
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
