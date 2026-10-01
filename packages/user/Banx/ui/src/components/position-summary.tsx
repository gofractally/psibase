import NumberFlow from "@number-flow/react";

import { CurrencyPicker } from "@/components/currency-picker";
import { formatMoney, isIsoCurrency, moneyFormatOptions, rawToNumber } from "@/lib/amount";
import type { Asset } from "@/lib/graphql";

import { cn } from "@shared/lib/utils";

export function PositionSummary({
    assets,
    assetId,
    onAssetId,
    held,
    owed,
    limit,
    precision,
    symbol,
    isLoading,
}: {
    assets: Asset[];
    assetId?: number;
    onAssetId: (id: number) => void;
    /** Claims the user holds in this currency. */
    held: bigint;
    /** Amounts the user owes in this currency. */
    owed: bigint;
    /** Credit-line limits extended to the user. Zero hides the used/limit ratio. */
    limit: bigint;
    precision: number;
    symbol: string;
    isLoading: boolean;
}) {
    const net = held - owed;
    const hasLimit = limit > 0n;

    return (
        <section
            aria-label="Position"
            className="bg-card rounded-xl border px-4 py-4 sm:px-5"
        >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <dl className="grid min-w-0 flex-1 grid-cols-3 items-start gap-x-3 sm:gap-x-6">
                    <Stat
                        label="Liability"
                        amount={owed}
                        limit={hasLimit ? limit : undefined}
                        precision={precision}
                        symbol={symbol}
                        isLoading={isLoading}
                        amountClass="text-amber-900 dark:text-amber-300"
                    />
                    <Stat
                        label="Assets"
                        amount={held}
                        precision={precision}
                        symbol={symbol}
                        isLoading={isLoading}
                        amountClass="text-emerald-800 dark:text-emerald-300"
                    />
                    <Stat
                        label="Net position"
                        amount={net}
                        precision={precision}
                        symbol={symbol}
                        isLoading={isLoading}
                        hint={!isLoading && net === 0n ? "Even" : undefined}
                        amountClass={
                            net < 0n
                                ? "text-amber-900 dark:text-amber-300"
                                : net > 0n
                                  ? "text-emerald-800 dark:text-emerald-300"
                                  : undefined
                        }
                    />
                </dl>
                <CurrencyPicker
                    assets={assets}
                    assetId={assetId}
                    onAssetId={onAssetId}
                />
            </div>
        </section>
    );
}

function Stat({
    label,
    amount,
    limit,
    precision,
    symbol,
    isLoading,
    hint,
    amountClass,
}: {
    label: string;
    amount: bigint;
    /** When set, the figure reads `amount / limit` (used against a credit limit). */
    limit?: bigint;
    precision: number;
    symbol: string;
    isLoading: boolean;
    hint?: string;
    amountClass?: string;
}) {
    const format = moneyFormatOptions(symbol, precision);
    const value = rawToNumber(amount, precision);
    const limitValue =
        limit !== undefined ? rawToNumber(limit, precision) : undefined;
    const shown = formatMoney(amount, precision, symbol);
    const limitShown =
        limit !== undefined ? formatMoney(limit, precision, symbol) : undefined;
    const ticker =
        !isIsoCurrency(symbol) && symbol ? (
            <span className="text-muted-foreground ml-1 text-xs font-sans font-normal sm:ml-1.5 sm:text-sm">
                {symbol}
            </span>
        ) : null;
    return (
        <div className="min-w-0">
            <dt className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase sm:text-xs">
                {label}
            </dt>
            <dd
                className="mt-1 text-base font-semibold tracking-tight sm:text-2xl"
                aria-label={
                    limitShown !== undefined
                        ? `${shown} of ${limitShown} credit limit`
                        : undefined
                }
            >
                {isLoading ? (
                    "…"
                ) : (
                    <>
                        <NumberFlow
                            value={value}
                            locales="en"
                            format={format}
                            className={cn("whitespace-nowrap", amountClass)}
                        />
                        {ticker}
                        {limitValue !== undefined ? (
                            <span className="text-muted-foreground mt-0.5 block text-xs font-medium whitespace-nowrap sm:mt-0 sm:ml-1.5 sm:inline sm:text-lg">
                                {"/ "}
                                <NumberFlow
                                    value={limitValue}
                                    locales="en"
                                    format={format}
                                    className="font-medium"
                                />
                            </span>
                        ) : null}
                    </>
                )}
            </dd>
            {hint ? (
                <p className="text-muted-foreground mt-1 text-[11px] leading-snug sm:text-xs">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
