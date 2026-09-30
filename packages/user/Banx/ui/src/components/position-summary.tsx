import { CurrencyPicker } from "@/components/currency-picker";
import type { GroupedAccount } from "@/lib/account-groups";
import { formatRawAmount } from "@/lib/amount";
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
    savings,
    loans,
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
    /** All savings groups, every currency. Used to rank the picker. */
    savings: GroupedAccount[];
    /** All loan groups, every currency. Used to rank the picker. */
    loans: GroupedAccount[];
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
                <dl className="grid min-w-0 flex-1 grid-cols-3 gap-2 sm:gap-6">
                    <Stat
                        label="Total liability"
                        amount={owed}
                        limit={hasLimit ? limit : undefined}
                        precision={precision}
                        symbol={symbol}
                        isLoading={isLoading}
                        hint={
                            !isLoading && hasLimit
                                ? "of your credit limit"
                                : undefined
                        }
                        amountClass="text-amber-900 dark:text-amber-300"
                    />
                    <Stat
                        label="Total assets"
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
                    savings={savings}
                    loans={loans}
                    isLoading={isLoading}
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
    const shown = isLoading
        ? "…"
        : formatRawAmount(amount.toString(), precision);
    const limitShown =
        !isLoading && limit !== undefined
            ? formatRawAmount(limit.toString(), precision)
            : undefined;
    const symbolEl = symbol ? (
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
                className="mt-1 font-mono text-base font-semibold tracking-tight tabular-nums sm:text-2xl"
                aria-label={
                    limitShown !== undefined
                        ? `${shown} of ${limitShown} ${symbol} credit limit`.trim()
                        : undefined
                }
            >
                {limitShown !== undefined ? (
                    <>
                        <span className={cn("whitespace-nowrap", amountClass)}>
                            {shown}
                        </span>
                        <span className="text-muted-foreground font-medium whitespace-nowrap">
                            {" / "}
                            {limitShown}
                        </span>
                    </>
                ) : (
                    <span className={cn("whitespace-nowrap", amountClass)}>
                        {shown}
                    </span>
                )}
                {symbolEl}
            </dd>
            {hint ? (
                <p className="text-muted-foreground mt-1 text-[11px] leading-snug sm:text-xs">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
