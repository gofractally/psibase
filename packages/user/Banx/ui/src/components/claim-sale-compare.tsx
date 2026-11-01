import { formatToPrecision } from "@/lib/amount";
import { cn } from "@shared/lib/utils";

const SAMPLE_FACE = 15;

function previewProceeds(
    face: number,
    feeFixed: string,
    feePct: string,
    isSell: boolean,
): number | null {
    const fixed = Number(String(feeFixed).trim());
    const pct = Number(String(feePct).trim());
    if (!Number.isFinite(fixed) || !Number.isFinite(pct)) return null;
    if (fixed < 0 || Math.abs(pct) >= 100) return null;
    const spread = isSell ? -pct : pct;
    const afterPct = face * (1 - spread / 100);
    if (fixed >= afterPct) return null;
    const out = afterPct - fixed;
    return out > 0 ? out : null;
}

function showAmount(amount: number, precision: number): string {
    return (
        formatToPrecision(amount.toFixed(Math.max(precision, 6)), precision) ??
        amount.toFixed(precision)
    );
}

function withSymbol(amount: string, symbol?: string): string {
    const unit = symbol?.trim();
    return unit ? `${amount} ${unit}` : amount;
}

function shortName(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 12 ? `${trimmed.slice(0, 11)}…` : trimmed;
}

function shownGap(gap: number, precision: number): string | null {
    if (Math.abs(gap) <= 1e-9) return null;
    const text = showAmount(Math.abs(gap), precision);
    return /^0(?:\.0+)?$/.test(text) ? null : text;
}

/**
 * Before and after a claim sale. The debtor's creditor changes, and
 * the buyer owes the seller the price after the maker's spread.
 */
export function ClaimSaleCompare({
    feeFixed,
    feePct,
    precision,
    isSell,
    you,
    symbol,
    other = "alice",
    debtor = "carol",
}: {
    feeFixed: string;
    feePct: string;
    precision: number;
    isSell: boolean;
    you: string;
    symbol?: string;
    other?: string;
    debtor?: string;
}) {
    const counterparty = other.trim() === you.trim() ? "holder" : other;
    const seller = isSell ? you : counterparty;
    const buyer = isSell ? counterparty : you;
    const proceeds = previewProceeds(SAMPLE_FACE, feeFixed, feePct, isSell);
    const faceStr = withSymbol(showAmount(SAMPLE_FACE, precision), symbol);
    const priceStr =
        proceeds === null
            ? null
            : withSymbol(showAmount(proceeds, precision), symbol);
    const gap =
        proceeds === null ? null : shownGap(SAMPLE_FACE - proceeds, precision);
    const underFace = proceeds !== null && proceeds < SAMPLE_FACE;
    const debtorName = shortName(debtor);
    const buyerName = shortName(buyer);
    const sellerName = shortName(seller);

    return (
        <figure className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted/40 min-w-0 rounded-lg border p-2">
                    <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                        Before
                    </p>
                    <ClaimRow
                        className="mt-2"
                        debtor={debtorName}
                        creditor={sellerName}
                        amount={faceStr}
                    />
                </div>
                <div className="bg-muted/40 min-w-0 rounded-lg border p-2">
                    <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                        After
                    </p>
                    <ClaimRow
                        className="mt-2"
                        debtor={debtorName}
                        creditor={buyerName}
                        amount={faceStr}
                        changed
                    />
                    {priceStr ? (
                        <ClaimRow
                            className="border-foreground/30 bg-foreground/5 mt-2"
                            debtor={buyerName}
                            creditor={sellerName}
                            amount={priceStr}
                            fresh
                        />
                    ) : (
                        <p className="text-muted-foreground mt-2 text-[11px] leading-snug">
                            The spread uses the whole claim. {sellerName} is
                            paid nothing.
                        </p>
                    )}
                </div>
            </div>
            <figcaption className="text-muted-foreground text-xs leading-relaxed">
                {debtorName}&apos;s creditor changes from {sellerName} to{" "}
                {buyerName}.{" "}
                {priceStr
                    ? `${buyerName} owes ${sellerName} ${priceStr}${
                          gap
                              ? `, ${withSymbol(gap, symbol)} ${underFace ? "under" : "over"} face`
                              : ""
                      }.`
                    : `The spread uses the whole claim, so ${sellerName} is paid nothing.`}
            </figcaption>
        </figure>
    );
}

function ClaimRow({
    debtor,
    creditor,
    amount,
    changed = false,
    fresh = false,
    className,
}: {
    debtor: string;
    creditor: string;
    amount: string;
    changed?: boolean;
    fresh?: boolean;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "bg-background rounded-md border px-2 py-1.5",
                className,
            )}
        >
            <p className="text-muted-foreground truncate text-[11px] leading-tight">
                {debtor} owes{" "}
                <span
                    className={cn(
                        changed &&
                            "bg-foreground/10 text-foreground rounded px-1 font-medium",
                    )}
                >
                    {creditor}
                </span>
                {fresh ? (
                    <span className="text-foreground/70 ml-1 text-[10px] tracking-wide uppercase">
                        New
                    </span>
                ) : null}
            </p>
            <p className="text-foreground mt-0.5 text-sm font-medium tabular-nums">
                {amount}
            </p>
        </div>
    );
}
