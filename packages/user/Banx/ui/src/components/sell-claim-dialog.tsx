import { useEffect, useMemo, useState } from "react";

import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2 } from "lucide-react";

import { useSellClaim } from "@/hooks/use-banx-mutations";
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
    type BuyClaimOffer,
    fetchCreditLines,
    fetchBuyClaimOffers,
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

function offerLive(p: BuyClaimOffer, nowSec: number): boolean {
    return p.expiresAt === 0 || p.expiresAt >= nowSec;
}

/** `out = in * (1 - spread) - fixed`. Negative spread is a premium. */
function applyTakeFee(
    amountRaw: bigint,
    feeFixedRaw: bigint,
    feePercentPpm: number,
): bigint | null {
    if (feePercentPpm >= PPM_SCALE || feePercentPpm <= -PPM_SCALE) {
        return null;
    }
    const keep = BigInt(PPM_SCALE - feePercentPpm);
    const afterPct = (amountRaw * keep) / BigInt(PPM_SCALE);
    if (feeFixedRaw >= afterPct) return null;
    const out = afterPct - feeFixedRaw;
    return out > 0n ? out : null;
}

function residualOnLine(
    lines: CreditLine[],
    buyer: string,
    debtor: string,
    assetId: number,
    precision: number,
): bigint {
    const line = lines.find(
        (l) =>
            l.creditor === buyer &&
            l.debtor === debtor &&
            l.assetId === assetId,
    );
    if (!line) return 0n;
    const limit = humanToRaw(line.limit || "0", precision);
    const exposure = humanToRaw(line.exposure || "0", precision);
    const remaining = humanToRaw(line.remaining || "0", precision);
    return lineAvailableRaw(
        limit,
        exposure,
        remaining,
        line.depleteOnDebit,
    );
}

/** Prefer specific counterparty offer over global; lower fee wins ties. */
function pickOffer(
    offers: BuyClaimOffer[],
    debtor: string,
    assetId: number,
    nowSec: number,
): BuyClaimOffer | null {
    const live = offers.filter(
        (o) =>
            o.assetId === assetId &&
            offerLive(o, nowSec) &&
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
    offer: BuyClaimOffer;
    residualRaw: bigint;
    maxFaceRaw: bigint;
};

export function SellClaimDialog({
    open,
    onOpenChange,
    target,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    target: SellClaimTarget | null;
}) {
    const { data: user } = useCurrentUser();
    const sellClaim = useSellClaim();
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
            queryKey: QueryKey.buyClaimOffers(account),
            queryFn: () => fetchBuyClaimOffers(account),
            enabled: open && !!target && !!account,
        })),
    });

    const lineQueries = useQueries({
        queries: loadAccounts.map((account) => ({
            queryKey: QueryKey.creditLines(account),
            queryFn: () => fetchCreditLines(account),
            enabled: open && !!target && !!account,
        })),
    });

    const debtorLinesQuery = useQuery({
        queryKey: QueryKey.creditLines(target?.debtor),
        queryFn: () => fetchCreditLines(target!.debtor),
        enabled: open && !!target,
    });

    const options: BuyerOption[] = useMemo(() => {
        if (!target) return [];
        const maxClaim = BigInt(target.maxRaw || "0");
        const debtorLines = debtorLinesQuery.data;
        if (!debtorLines) return [];
        const out: BuyerOption[] = [];
        loadAccounts.forEach((account, i) => {
            const offers = offerQueries[i]?.data;
            const lines = lineQueries[i]?.data;
            if (!offers || !lines) return;
            const offer = pickOffer(
                offers,
                target.debtor,
                target.assetId,
                nowSec,
            );
            if (!offer) return;
            if (!offer.allowUnknown) {
                const debtorLinedBuyer = debtorLines.some(
                    (l) =>
                        l.creditor === target.debtor &&
                        l.debtor === account &&
                        l.assetId === target.assetId,
                );
                if (!debtorLinedBuyer) return;
            }
            const residual = residualOnLine(
                lines,
                account,
                target.debtor,
                target.assetId,
                target.precision,
            );
            if (residual <= 0n) return;
            const maxFace =
                residual < maxClaim ? residual : maxClaim;
            if (maxFace <= 0n) return;
            const contact = (contacts as LocalContact[]).find(
                (c) => c.account === account,
            );
            const nick = contact?.nickname?.trim();
            out.push({
                buyer: account,
                label: nick ? `${nick} (${account})` : account,
                offer,
                residualRaw: residual,
                maxFaceRaw: maxFace,
            });
        });
        out.sort((a, b) => a.label.localeCompare(b.label));
        return out;
    }, [
        target,
        loadAccounts,
        offerQueries,
        lineQueries,
        debtorLinesQuery.data,
        nowSec,
        contacts,
    ]);

    const selected = options.find((o) => o.buyer === selectedBuyer) ?? null;
    const loading =
        open &&
        loadAccounts.length > 0 &&
        (offerQueries.some((q) => q.isLoading) ||
            lineQueries.some((q) => q.isLoading) ||
            debtorLinesQuery.isLoading);

    const precision = target?.precision ?? 0;
    const maxHuman = target
        ? formatRawAmount(
              selected?.maxFaceRaw.toString() ?? target.maxRaw,
              precision,
          ).replace(/,/g, "")
        : "0";

    const form = useAppForm({
        defaultValues: { amount: maxHuman },
        onSubmit: async ({ value }) => {
            if (!target || !selected) return;
            const amount = value.amount.trim();
            await new Promise<void>((resolve, reject) => {
                sellClaim.mutate(
                    {
                        buyer: selected.buyer,
                        debtor: target.debtor,
                        assetId: target.assetId,
                        amount,
                    },
                    {
                        onSuccess: () => {
                            onOpenChange(false);
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
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
        form.setFieldValue("amount", maxHuman);
        // form identity is stable enough for reset on open
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, targetKey]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md gap-4">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowLeftRight className="size-4" />
                        Sell claim
                    </DialogTitle>
                    <DialogDescription>
                        {target ? (
                            <>
                                Transfer your claim on{" "}
                                <span className="text-foreground font-medium">
                                    {target.debtor}
                                </span>{" "}
                                ({target.symbol}) to a buyer who posted a
                                buy-claim offer. Closed offers also need{" "}
                                {target.debtor} to have lined that buyer (a
                                zero limit is enough). You receive a claim on
                                the buyer for face after their spread
                                (haircut or premium).
                            </>
                        ) : (
                            "Select a claim to sell."
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
                                Buyer account
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
                                Type an account to check their offers, or pick
                                from contacts below.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Buyers with capacity</Label>
                            {loading ? (
                                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                    <Loader2 className="size-4 animate-spin" />
                                    Loading offers…
                                </div>
                            ) : options.length === 0 ? (
                                <p className="text-muted-foreground text-sm">
                                    No contacts (or typed account) currently
                                    have both a live buy-claim offer and credit
                                    residual toward {target.debtor} in{" "}
                                    {target.symbol}.
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
                                                            ? ` → you get ${formatRawAmount(sample.toString(), precision)}`
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
                                          )
                                        : null;
                                if (proceedsRaw !== null) {
                                    return (
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
                                            raise face or pick another buyer.
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
                                    labels={["Sell claim", "Selling…"]}
                                    loading={sellClaim.isPending}
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
