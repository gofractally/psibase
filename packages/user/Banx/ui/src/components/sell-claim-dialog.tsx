import { useEffect, useMemo, useState } from "react";

import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2 } from "lucide-react";

import { useBuyClaim, useSellClaim } from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    displayAmount,
    formatRawAmount,
    humanToRaw,
    lineAvailableRaw,
} from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import {
    type CreditLine,
    type ClaimOffer,
    type Obligation,
    fetchCreditLines,
    fetchClaimOffers,
    fetchObligations,
} from "@/lib/graphql";
import { QueryKey } from "@/lib/query-keys";
import { PPM_SCALE } from "@/lib/constants";

import {
    type LocalContact,
    useContacts,
} from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { cn } from "@shared/lib/utils";

function offerLive(p: ClaimOffer, nowSec: number): boolean {
    return p.expiresAt === 0 || p.expiresAt >= nowSec;
}

/** `out = in * (1 - spread) - fixed`. Negative spread is a premium.
 *  Sell-offer posts negate the stored spread so positive is seller profit. */
function applyTakeFee(
    amountRaw: bigint,
    feeFixedRaw: bigint,
    feePercentPpm: number,
    flipSpread = false,
): bigint | null {
    const ppm = flipSpread ? -feePercentPpm : feePercentPpm;
    if (ppm >= PPM_SCALE || ppm <= -PPM_SCALE) {
        return null;
    }
    const keep = BigInt(PPM_SCALE - ppm);
    const afterPct = (amountRaw * keep) / BigInt(PPM_SCALE);
    if (feeFixedRaw >= afterPct) return null;
    const out = afterPct - feeFixedRaw;
    return out > 0n ? out : null;
}

function obligationRaw(o: Obligation, precision: number): bigint {
    return (
        humanToRaw(o.remainingPrincipal || "0", precision) +
        humanToRaw(o.accruedInterest || "0", precision)
    );
}

/** `Connection::knows(debtor, buyer)`: the debtor lined the buyer, or the debtor already owes the buyer. */
function debtorKnowsBuyer(
    lines: CreditLine[],
    obligations: Obligation[],
    debtor: string,
    buyer: string,
    assetId: number,
    precision: number,
): boolean {
    if (
        lines.some(
            (l) =>
                l.creditor === debtor &&
                l.debtor === buyer &&
                l.assetId === assetId,
        )
    ) {
        return true;
    }
    return obligations.some(
        (o) =>
            o.assetId === assetId &&
            o.creditor === buyer &&
            o.debtor === debtor &&
            obligationRaw(o, precision) > 0n,
    );
}

/** What the buyer already owes the debtor. A take can unwind this with no line. */
function reverseClaimRaw(
    obligations: Obligation[],
    debtor: string,
    buyer: string,
    assetId: number,
    precision: number,
): bigint {
    let sum = 0n;
    for (const o of obligations) {
        if (
            o.assetId === assetId &&
            o.creditor === debtor &&
            o.debtor === buyer
        ) {
            sum += obligationRaw(o, precision);
        }
    }
    return sum;
}

/**
 * Face the buyer can take: reverse claim, plus line headroom only when a
 * buyer→debtor line exists and the debtor knows the buyer.
 */
function claimCapacityRaw(
    buyerLines: CreditLine[],
    debtorLines: CreditLine[],
    obligations: Obligation[],
    buyer: string,
    debtor: string,
    assetId: number,
    precision: number,
): bigint {
    const reverse = reverseClaimRaw(
        obligations,
        debtor,
        buyer,
        assetId,
        precision,
    );
    const line = buyerLines.find(
        (l) =>
            l.creditor === buyer &&
            l.debtor === debtor &&
            l.assetId === assetId,
    );
    if (
        !line ||
        !debtorKnowsBuyer(
            debtorLines,
            obligations,
            debtor,
            buyer,
            assetId,
            precision,
        )
    ) {
        return reverse;
    }
    const headroom = lineAvailableRaw(
        humanToRaw(line.limit || "0", precision),
        humanToRaw(line.exposure || "0", precision),
        humanToRaw(line.remaining || "0", precision),
        line.depleteOnDebit,
    );
    return reverse + (headroom > 0n ? headroom : 0n);
}

function claimHeldRaw(
    obligations: Obligation[],
    seller: string,
    debtor: string,
    assetId: number,
    precision: number,
): bigint {
    let sum = 0n;
    for (const o of obligations) {
        if (
            o.creditor === seller &&
            o.debtor === debtor &&
            o.assetId === assetId
        ) {
            sum += obligationRaw(o, precision);
        }
    }
    return sum;
}

/** Prefer specific counterparty offer over global; lower fee wins ties. */
function pickOffer(
    offers: ClaimOffer[],
    debtor: string,
    assetId: number,
    nowSec: number,
    wantSell: boolean,
): ClaimOffer | null {
    const live = offers.filter(
        (o) =>
            o.assetId === assetId &&
            offerLive(o, nowSec) &&
            (wantSell ? o.isSell : o.isBuy) &&
            (o.isGlobal ||
                !o.debtor ||
                o.debtor === debtor ||
                o.debtor === "0"),
    );
    if (live.length === 0) return null;
    live.sort((a, b) => {
        const aSpec = !a.isGlobal && a.debtor === debtor ? 0 : 1;
        const bSpec = !b.isGlobal && b.debtor === debtor ? 0 : 1;
        if (aSpec !== bSpec) return aSpec - bSpec;
        if (a.feePercentPpm !== b.feePercentPpm) {
            return a.feePercentPpm - b.feePercentPpm;
        }
        // feeFixed is human decimal; compare numerically via string number
        const af = Number(a.feeFixed);
        const bf = Number(b.feeFixed);
        if (af !== bf) return af - bf;
        return 0;
    });
    return live[0] ?? null;
}

export type SellClaimTarget = {
    debtor: string;
    assetId: number;
    /** Max face to sell (raw units). */
    maxRaw: string;
    symbol: string;
    precision: number;
};

type BuyerOption = {
    buyer: string;
    label: string;
    offer: ClaimOffer;
    maxFaceRaw: bigint;
};

export function SellClaimDialog({
    open,
    onOpenChange,
    target,
    mode = "sell",
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    target: SellClaimTarget | null;
    /** `sell` hits a buyer's bid; `buy` hits a seller's ask. */
    mode?: "sell" | "buy";
}) {
    const { data: user } = useCurrentUser();
    const sellClaim = useSellClaim();
    const buyClaim = useBuyClaim();
    const takingAsk = mode === "buy";
    const { data: hasPermission } = useHasProfilesReadPermission({
        enabled: !!user && open,
    });
    const { data: contacts = [] } = useContacts(
        user,
        { enabled: !!user && !!hasPermission && open },
        { enabled: true, returnPath: "/accounts" },
    );

    const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null);
    const [manualBuyer, setManualBuyer] = useState("");
    const nowSec = Math.floor(Date.now() / 1000);

    const contactAccounts = useMemo(() => {
        const set = new Set<string>();
        for (const c of contacts as LocalContact[]) {
            if (c.account && c.account !== user) set.add(c.account);
        }
        return [...set];
    }, [contacts, user]);

    const manual = manualBuyer.trim();
    const loadAccounts = useMemo(() => {
        const list = [...contactAccounts];
        if (manual && !list.includes(manual) && manual !== user) {
            list.push(manual);
        }
        return list;
    }, [contactAccounts, manual, user]);

    const offerQueries = useQueries({
        queries: loadAccounts.map((account) => ({
            queryKey: QueryKey.claimOffers(account),
            queryFn: () => fetchClaimOffers(account),
            enabled: open && !!target && !!account,
        })),
    });

    const lineQueries = useQueries({
        queries: loadAccounts.map((account) => ({
            queryKey: QueryKey.creditLines(account),
            queryFn: () => fetchCreditLines(account),
            enabled: open && !!target && !!account && !takingAsk,
        })),
    });

    const debtorLinesQuery = useQuery({
        queryKey: QueryKey.creditLines(target?.debtor),
        queryFn: () => fetchCreditLines(target!.debtor),
        enabled: open && !!target,
    });

    const debtorObligationsQuery = useQuery({
        queryKey: QueryKey.obligations(target?.debtor),
        queryFn: () => fetchObligations(target!.debtor),
        enabled: open && !!target,
    });

    const userLinesQuery = useQuery({
        queryKey: QueryKey.creditLines(user),
        queryFn: () => fetchCreditLines(user!),
        enabled: open && takingAsk && !!user,
    });

    const options: BuyerOption[] = useMemo(() => {
        if (!target || !user) return [];
        const maxClaim = BigInt(target.maxRaw || "0");
        const debtorLines = debtorLinesQuery.data;
        const debtorObs = debtorObligationsQuery.data;
        if (!debtorLines || !debtorObs) return [];
        const buyerLinesForCap = takingAsk ? userLinesQuery.data : null;
        if (takingAsk && !buyerLinesForCap) return [];
        const out: BuyerOption[] = [];
        loadAccounts.forEach((account, i) => {
            const offers = offerQueries[i]?.data;
            if (!offers) return;
            const offer = pickOffer(
                offers,
                target.debtor,
                target.assetId,
                nowSec,
                takingAsk,
            );
            if (!offer) return;
            const buyer = takingAsk ? user : account;
            const seller = takingAsk ? account : user;
            if (
                buyer === seller ||
                buyer === target.debtor ||
                seller === target.debtor
            ) {
                return;
            }
            const capLines = takingAsk
                ? buyerLinesForCap
                : lineQueries[i]?.data;
            if (!capLines) return;
            const capacity = claimCapacityRaw(
                capLines,
                debtorLines,
                debtorObs,
                buyer,
                target.debtor,
                target.assetId,
                target.precision,
            );
            if (capacity <= 0n) return;
            const offerLeft = humanToRaw(
                offer.remaining || "0",
                target.precision,
            );
            if (offerLeft <= 0n) return;
            const held = takingAsk
                ? claimHeldRaw(
                      debtorObs,
                      seller,
                      target.debtor,
                      target.assetId,
                      target.precision,
                  )
                : maxClaim;
            if (held <= 0n) return;
            let maxFace = capacity < held ? capacity : held;
            if (offerLeft < maxFace) maxFace = offerLeft;
            if (maxFace <= 0n) return;
            const contact = (contacts as LocalContact[]).find(
                (c) => c.account === account,
            );
            const nick = contact?.nickname?.trim();
            out.push({
                buyer: account,
                label: nick ? `${nick} (${account})` : account,
                offer,
                maxFaceRaw: maxFace,
            });
        });
        out.sort((a, b) => a.label.localeCompare(b.label));
        return out;
    }, [
        target,
        user,
        loadAccounts,
        offerQueries,
        lineQueries,
        debtorLinesQuery.data,
        debtorObligationsQuery.data,
        userLinesQuery.data,
        nowSec,
        contacts,
        takingAsk,
    ]);

    const selected = options.find((o) => o.buyer === selectedBuyer) ?? null;
    const loading =
        open &&
        loadAccounts.length > 0 &&
        (offerQueries.some((q) => q.isLoading) ||
            (!takingAsk && lineQueries.some((q) => q.isLoading)) ||
            debtorLinesQuery.isLoading ||
            debtorObligationsQuery.isLoading ||
            (takingAsk && userLinesQuery.isLoading));

    const precision = target?.precision ?? 0;

    const form = useAppForm({
        defaultValues: { amount: "" },
        onSubmit: async ({ value }) => {
            if (!target || !selected) return;
            const amount = value.amount.trim();
            const amountRaw = humanToRaw(amount, target.precision);
            if (amountRaw <= 0n || amountRaw > selected.maxFaceRaw) {
                toast.error(
                    "Amount is larger than this offer can take.",
                );
                return;
            }
            await new Promise<void>((resolve, reject) => {
                const done = {
                    onSuccess: () => {
                        onOpenChange(false);
                        resolve();
                    },
                    onError: (e: Error) => reject(e),
                };
                if (takingAsk) {
                    buyClaim.mutate(
                        {
                            seller: selected.buyer,
                            debtor: target.debtor,
                            assetId: target.assetId,
                            amount,
                        },
                        done,
                    );
                } else {
                    sellClaim.mutate(
                        {
                            buyer: selected.buyer,
                            debtor: target.debtor,
                            assetId: target.assetId,
                            amount,
                        },
                        done,
                    );
                }
            });
        },
    });

    const targetKey = target
        ? `${target.debtor}:${target.assetId}:${target.maxRaw}`
        : "";
    useEffect(() => {
        if (!open) return;
        setSelectedBuyer(null);
        setManualBuyer("");
        form.setFieldValue("amount", "");
        // form identity is stable enough for reset on open
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, targetKey]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md gap-4">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowLeftRight className="size-4" />
                        {takingAsk ? "Buy claim" : "Sell claim"}
                    </DialogTitle>
                    <DialogDescription>
                        {target ? (
                            takingAsk ? (
                            <>
                                Buy a posted claim on{" "}
                                <span className="text-foreground font-medium">
                                    {target.debtor}
                                </span>{" "}
                                ({target.symbol}). A new draw needs{" "}
                                {target.debtor} to know you — a line from
                                them to you, or they already owe you — and
                                your credit line to them. Unwinding what
                                you already owe them needs neither. You get
                                the claim on {target.debtor}; the seller
                                receives face after their spread as a claim
                                on you.
                            </>
                            ) : (
                            <>
                                Transfer your claim on{" "}
                                <span className="text-foreground font-medium">
                                    {target.debtor}
                                </span>{" "}
                                ({target.symbol}) to a buyer with a live
                                buy-claim offer. A new draw needs{" "}
                                {target.debtor} to know the buyer — a line
                                from {target.debtor} to them, or{" "}
                                {target.debtor} already owes them — and the
                                buyer's credit line. Unwinding what the
                                buyer already owes needs neither. You
                                receive a claim on the buyer for face after
                                their spread.
                            </>
                            )
                        ) : (
                            takingAsk
                                ? "Select a claim to buy."
                                : "Select a claim to sell."
                        )}
                    </DialogDescription>
                </DialogHeader>

                {!target ? null : (
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                    >
                        <div className="grid gap-2">
                            <Label htmlFor="sell-buyer-manual">
                                {takingAsk
                                    ? "Seller account"
                                    : "Buyer account"}
                            </Label>
                            <Input
                                id="sell-buyer-manual"
                                placeholder="peter"
                                value={manualBuyer}
                                onChange={(e) =>
                                    setManualBuyer(e.target.value)
                                }
                            />
                            <p className="text-muted-foreground text-xs">
                                Type an account to check their{" "}
                                {takingAsk ? "asks" : "bids"}, or pick from
                                contacts below.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label>
                                {takingAsk
                                    ? "Sellers with a live ask"
                                    : "Buyers with a live bid"}
                            </Label>
                            {loading ? (
                                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                    <Loader2 className="size-4 animate-spin" />
                                    Loading offers…
                                </div>
                            ) : options.length === 0 ? (
                                <p className="text-muted-foreground text-sm">
                                    {takingAsk
                                        ? `No contacts (or typed account) currently have a live sell-claim offer on ${target.debtor} in ${target.symbol} you can take. A new draw needs ${target.debtor} to know you; unwinding what you already owe them does not.`
                                        : `No contacts (or typed account) currently have a live buy-claim offer on ${target.debtor} in ${target.symbol} you can fill. A new draw needs ${target.debtor} to know the buyer; unwinding what the buyer already owes does not.`}
                                </p>
                            ) : (
                                <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                                    {options.map((o) => {
                                        const active =
                                            selectedBuyer === o.buyer;
                                        const sample = applyTakeFee(
                                            o.maxFaceRaw,
                                            humanToRaw(
                                                o.offer.feeFixed || "0",
                                                precision,
                                            ),
                                            o.offer.feePercentPpm,
                                            takingAsk,
                                        );
                                        return (
                                            <li key={o.buyer}>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        "hover:bg-muted/80 w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                                                        active &&
                                                            "border-primary bg-primary/5",
                                                    )}
                                                    onClick={() => {
                                                        setSelectedBuyer(
                                                            o.buyer,
                                                        );
                                                        const h =
                                                            formatRawAmount(
                                                                o.maxFaceRaw.toString(),
                                                                precision,
                                                            ).replace(
                                                                /,/g,
                                                                "",
                                                            );
                                                        form.setFieldValue(
                                                            "amount",
                                                            h,
                                                        );
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="font-medium">
                                                            {o.label}
                                                        </span>
                                                        <span className="text-muted-foreground font-mono text-xs">
                                                            fee{" "}
                                                            {(
                                                                o.offer
                                                                    .feePercentPpm /
                                                                10_000
                                                            ).toString()}
                                                            %
                                                            {humanToRaw(
                                                                o.offer
                                                                    .feeFixed ||
                                                                    "0",
                                                                precision,
                                                            ) > 0n
                                                                ? ` + ${displayAmount(o.offer.feeFixed)}`
                                                                : ""}
                                                        </span>
                                                    </div>
                                                    <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                                                        up to{" "}
                                                        {formatRawAmount(
                                                            o.maxFaceRaw.toString(),
                                                            precision,
                                                        )}{" "}
                                                        {target.symbol}
                                                        {sample !== null
                                                            ? takingAsk
                                                                ? ` → seller gets ${formatRawAmount(sample.toString(), precision)}`
                                                                : ` → you get ${formatRawAmount(sample.toString(), precision)}`
                                                            : ""}
                                                    </p>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        <form.AppField
                            name="amount"
                            validators={{
                                onChange: amountFieldValidator(precision, {
                                    allowZero: false,
                                }),
                                onSubmit: amountFieldValidator(precision, {
                                    allowZero: false,
                                }),
                            }}
                            children={(field) => (
                                <field.TextField
                                    label={`Face amount (${target.symbol})`}
                                    inputMode="decimal"
                                    placeholder={amountPlaceholder(precision)}
                                    disabled={!selected}
                                />
                            )}
                        />

                        <form.Subscribe
                            selector={(s) => s.values.amount}
                            children={(amountStr) => {
                                if (!selected) return null;
                                const amountRaw = humanToRaw(
                                    amountStr,
                                    precision,
                                );
                                const feeFixedRaw = humanToRaw(
                                    selected.offer.feeFixed || "0",
                                    precision,
                                );
                                const proceedsRaw =
                                    amountRaw > 0n
                                        ? applyTakeFee(
                                              amountRaw,
                                              feeFixedRaw,
                                              selected.offer.feePercentPpm,
                                              takingAsk,
                                          )
                                        : null;
                                if (proceedsRaw !== null) {
                                    return takingAsk ? (
                                        <p className="text-muted-foreground text-sm font-mono">
                                            You get{" "}
                                            {formatRawAmount(
                                                amountRaw.toString(),
                                                precision,
                                            )}{" "}
                                            {target.symbol} claim on{" "}
                                            {target.debtor}. Seller receives
                                            ≈{" "}
                                            {formatRawAmount(
                                                proceedsRaw.toString(),
                                                precision,
                                            )}{" "}
                                            {target.symbol} claim on you.
                                        </p>
                                    ) : (
                                        <p className="text-muted-foreground text-sm font-mono">
                                            You receive ≈{" "}
                                            {formatRawAmount(
                                                proceedsRaw.toString(),
                                                precision,
                                            )}{" "}
                                            {target.symbol} claim on{" "}
                                            {selected.buyer}
                                        </p>
                                    );
                                }
                                if (amountRaw > 0n) {
                                    return (
                                        <p className="text-destructive text-sm">
                                            Fee would consume this amount —
                                            raise face or pick another{" "}
                                            {takingAsk ? "seller" : "buyer"}.
                                        </p>
                                    );
                                }
                                return null;
                            }}
                        />

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={
                                        takingAsk
                                            ? ["Buy claim", "Buying…"]
                                            : ["Sell claim", "Selling…"]
                                    }
                                    loading={
                                        sellClaim.isPending ||
                                        buyClaim.isPending
                                    }
                                    disabled={!selected || !user}
                                />
                            </form.AppForm>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
