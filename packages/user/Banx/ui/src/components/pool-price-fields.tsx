import { useId, useState } from "react";

import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

function parsePositive(raw: string): number | undefined {
    const t = raw.trim().replaceAll(",", "");
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
}

/** Round a human amount to the asset's precision, or "" if it rounds to nothing. */
function roundReserve(amount: number, precision: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return "";
    const digits = Math.min(Math.max(precision, 0), 8);
    const text = amount.toFixed(digits).replace(/\.?0+$/, "");
    return parsePositive(text) === undefined ? "" : text;
}

function formatPrice(price: number): string {
    if (!Number.isFinite(price) || price <= 0) return "";
    return price.toFixed(8).replace(/\.?0+$/, "");
}

/**
 * Reserves that price 1 of the kept asset at `price` of the other.
 * The kept reserve stays put. The other moves. An empty pool starts at 1.
 */
function reservesForPrice(
    price: number,
    keep: string,
    other: string,
    keepPrecision: number,
    otherPrecision: number,
): { keep: string; other: string } | null {
    if (!Number.isFinite(price) || price <= 0) return null;
    const kept = parsePositive(keep);
    const rest = parsePositive(other);
    const keepAmount = kept ?? (rest !== undefined ? rest / price : 1);
    const nextKeep = roundReserve(keepAmount, keepPrecision);
    const nextOther = roundReserve(keepAmount * price, otherPrecision);
    if (!nextKeep || !nextOther) return null;
    return { keep: nextKeep, other: nextOther };
}

/**
 * Market prices for a two-reserve pool. Typing one moves the other reserve.
 * The reserve already typed stays. An empty pool starts at 1 of the priced side.
 */
export function PoolPriceFields({
    symbolA,
    symbolB,
    precisionA,
    precisionB,
    reserveA,
    reserveB,
    disabled,
    onReserves,
}: {
    symbolA: string;
    symbolB: string;
    precisionA: number;
    precisionB: number;
    reserveA: string;
    reserveB: string;
    disabled?: boolean;
    onReserves: (reserveA: string, reserveB: string) => void;
}) {
    const id = useId();
    const [draft, setDraft] = useState<"a" | "b" | null>(null);
    const [text, setText] = useState("");
    const a = parsePositive(reserveA);
    const b = parsePositive(reserveB);
    const derivedA = a !== undefined && b !== undefined ? formatPrice(b / a) : "";
    const derivedB = a !== undefined && b !== undefined ? formatPrice(a / b) : "";
    const typed = parsePositive(text);
    const shownA =
        draft === "a"
            ? text
            : draft === "b" && typed !== undefined
              ? formatPrice(1 / typed)
              : derivedA;
    const shownB =
        draft === "b"
            ? text
            : draft === "a" && typed !== undefined
              ? formatPrice(1 / typed)
              : derivedB;

    const apply = (side: "a" | "b", raw: string) => {
        setDraft(side);
        setText(raw);
        const price = parsePositive(raw);
        if (price === undefined) return;
        const next =
            side === "a"
                ? reservesForPrice(price, reserveA, reserveB, precisionA, precisionB)
                : reservesForPrice(price, reserveB, reserveA, precisionB, precisionA);
        if (!next) return;
        if (side === "a") onReserves(next.keep, next.other);
        else onReserves(next.other, next.keep);
    };

    const clear = () => {
        setDraft(null);
        setText("");
    };

    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
                <Label htmlFor={`${id}-a`}>{symbolA} price</Label>
                <div className="relative">
                    <Input
                        id={`${id}-a`}
                        inputMode="decimal"
                        value={shownA}
                        placeholder="0.00"
                        className="pr-16"
                        disabled={disabled}
                        onChange={(e) => apply("a", e.target.value)}
                        onBlur={clear}
                    />
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                        {symbolB}
                    </span>
                </div>
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`${id}-b`}>{symbolB} price</Label>
                <div className="relative">
                    <Input
                        id={`${id}-b`}
                        inputMode="decimal"
                        value={shownB}
                        placeholder="0.00"
                        className="pr-16"
                        disabled={disabled}
                        onChange={(e) => apply("b", e.target.value)}
                        onBlur={clear}
                    />
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                        {symbolA}
                    </span>
                </div>
            </div>
            <p className="text-muted-foreground text-sm sm:col-span-2">
                {disabled
                    ? "Pick two assets, then type a market price. The other reserve moves to match."
                    : "Type a market price and the other reserve moves to match. The reserve you typed stays. An empty pool starts at 1."}
            </p>
        </div>
    );
}
