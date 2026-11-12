import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { AssetField } from "@/components/form-fields";
import { PageHeader } from "@/components/page-header";
import { PathRoute } from "@/components/path-route";
import { useAssetMap } from "@/hooks/use-assets";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import {
    useBanxRelays,
    useTokenPrecisionMap,
    useTokenRelays,
} from "@/hooks/use-banx-data";
import {
    useCurveQuote,
    usePathCash,
    usePathPay,
    useQuotePath,
    useRemoveRelay,
    useRemoveTokenRelay,
    useSetRelay,
    useSetTokenRelay,
    type PathHopQuote,
    type PathQuote,
} from "@/hooks/use-banx-mutations";
import { accountHref } from "@/lib/account-groups";
import {
    amountPlaceholder,
    displayAmount,
    formatRawAmount,
    humanToRaw,
    rawToFixed,
} from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    amountFieldValidator,
    existingAccountValidators,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { Asset, BanxRelay, TokenRelay } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

const DEFAULT_HOPS = "6";

function parseTokenId(raw: string): number | undefined {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n <= 0) return undefined;
    return n;
}

function hopCountError(value: string): string | undefined {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 1 || n > 12) return "Use 1 to 12 hops";
    return undefined;
}

function hopCount(value: string): number {
    const n = Number(value.trim());
    return Number.isInteger(n) ? Math.min(12, Math.max(1, n)) : 6;
}

function unordered(a: number, b: number): [number, number] {
    return a < b ? [a, b] : [b, a];
}

function relayKey(owner: string, lo: number, hi: number): string {
    return `${owner}:${lo}:${hi}`;
}

/** Price of one unit of each weight in the other. Both weights are one market value. */
function relayUnitPrices(
    reserveA: string,
    reserveB: string,
): { aInB: string; bInA: string } | null {
    const a = Number(reserveA);
    const b = Number(reserveB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        return null;
    }
    return { aInB: (b / a).toFixed(4), bInA: (a / b).toFixed(4) };
}

function samePair(row: BanxRelay, a: number, b: number): boolean {
    const [lo, hi] = unordered(a, b);
    return row.assetLo === lo && row.assetHi === hi;
}

function reserveOf(row: BanxRelay, assetId: number): string | undefined {
    if (row.assetLo === assetId) return row.reserveLo;
    if (row.assetHi === assetId) return row.reserveHi;
    return undefined;
}

function shownAmount(amount: string): boolean {
    const shown = displayAmount(amount);
    return shown !== "0" && !/^0\.0+$/.test(shown);
}

function tokenRowKey(row: TokenRelay): string {
    return `${row.owner}:${row.assetId}:${row.tokenId}`;
}

function matchingTokenRelays(
    rows: TokenRelay[],
    assetId: number | undefined,
    tokenId: number | undefined,
): TokenRelay[] {
    if (assetId === undefined) return [];
    return rows.filter((row) => {
        if (row.assetId !== assetId) return false;
        if (tokenId !== undefined && row.tokenId !== tokenId) return false;
        return true;
    });
}

function chooseTokenRelay(
    rows: TokenRelay[],
    assetId: number | undefined,
    tokenId: number | undefined,
    picked: string | null,
): TokenRelay | undefined {
    const matches = matchingTokenRelays(rows, assetId, tokenId);
    return (
        matches.find((row) => tokenRowKey(row) === picked) ??
        (matches.length === 1 ? matches[0] : undefined)
    );
}

function who(account: string, labelOf: (account: string) => string): string {
    const name = labelOf(account);
    return name === account ? account : `${name} (${account})`;
}

/** Relay owners on a quoted path. FX is recorded on the hop that receives the new asset. */
function usedRelayKeys(hops: PathHopQuote[]): Set<string> {
    const keys = new Set<string>();
    hops.forEach((hop, i) => {
        const from = hop.fxFromAsset;
        const prev = hops[i - 1];
        if (from === undefined || !prev) return;
        const [lo, hi] = unordered(from, hop.assetId);
        keys.add(relayKey(prev.account, lo, hi));
    });
    return keys;
}

type Conversion = {
    key: string;
    owner: string;
    fromAsset: number;
    toAsset: number;
    input: string;
    output: string;
    hopFee: string;
    relay: boolean;
    payee: string;
};

function pathConversions(
    hops: PathHopQuote[],
    relays: BanxRelay[],
): Conversion[] {
    const rows: Conversion[] = [];
    hops.forEach((hop, i) => {
        const from = hop.fxFromAsset;
        const prev = hops[i - 1];
        if (from === undefined || !prev) return;
        const [lo, hi] = unordered(from, hop.assetId);
        rows.push({
            key: `${relayKey(prev.account, lo, hi)}:${i}`,
            owner: prev.account,
            fromAsset: from,
            toAsset: hop.assetId,
            input: prev.amount,
            output: hop.amount,
            hopFee: hop.hopFee,
            relay: relays.some(
                (row) =>
                    row.owner === prev.account &&
                    row.assetLo === lo &&
                    row.assetHi === hi,
            ),
            payee: hop.account,
        });
    });
    return rows;
}

function CurveQuote({
    row,
    fromAsset,
    toAsset,
    amount,
    exactOut,
    precisionOf,
}: {
    row: BanxRelay;
    fromAsset: number;
    toAsset: number;
    amount: string;
    exactOut: boolean;
    precisionOf: (id: number) => number;
}) {
    const fromReserve = reserveOf(row, fromAsset);
    const toReserve = reserveOf(row, toAsset);
    const fromPrec = precisionOf(fromAsset);
    const toPrec = precisionOf(toAsset);
    const raw = humanToRaw(amount.trim(), exactOut ? toPrec : fromPrec);
    const reserveIn =
        fromReserve === undefined ? 0n : humanToRaw(fromReserve, fromPrec);
    const reserveOut =
        toReserve === undefined ? 0n : humanToRaw(toReserve, toPrec);
    const quote = useCurveQuote(
        reserveIn,
        reserveOut,
        raw,
        row.feePpm,
        exactOut,
    );
    if (fromReserve === undefined || toReserve === undefined || raw <= 0n) {
        return "—";
    }
    if (quote.isLoading) return "…";
    if (quote.isError || quote.data == null) return "Cannot fill";
    return exactOut
        ? `Needs ${formatRawAmount(quote.data.toString(), fromPrec)}`
        : `Pays ${formatRawAmount(quote.data.toString(), toPrec)}`;
}

function TokenCurvePay({
    reserveIn,
    reserveOut,
    amountIn,
    feePpm,
    tokenPrec,
    precisionFailed,
    tokenId,
    recipient,
    canPay,
    pending,
    onPay,
}: {
    reserveIn: bigint;
    reserveOut: bigint;
    amountIn: bigint;
    feePpm: number;
    tokenPrec: number | undefined;
    precisionFailed: boolean;
    tokenId: number;
    recipient: string;
    canPay: boolean;
    pending: boolean;
    onPay: (tokensOut: bigint) => void;
}) {
    const quote = useCurveQuote(reserveIn, reserveOut, amountIn, feePpm, false);
    const tokensOut = tokenPrec === undefined ? null : quote.data;
    const sentence =
        tokenPrec === undefined
            ? precisionFailed
                ? `Couldn't load precision for token #${tokenId}.`
                : `Token #${tokenId} precision is still loading.`
            : quote.isLoading
              ? "Quoting the token relay."
              : tokensOut == null
                ? "The token vault cannot cover that draw."
                : `Their token #${tokenId} relay then pays ${formatRawAmount(tokensOut.toString(), tokenPrec)} to ${recipient}.`;
    return (
        <>
            <p className="text-sm">{sentence}</p>
            <Button
                type="button"
                disabled={
                    pending || tokensOut == null || tokenPrec === undefined || !canPay
                }
                onClick={() => {
                    if (tokensOut == null) return;
                    onPay(tokensOut);
                }}
            >
                {pending ? "Paying…" : "Pay along this path"}
            </Button>
        </>
    );
}

function AccountLink({ account }: { account: string }) {
    return (
        <Link to={accountHref(account)} className="hover:underline">
            {account}
        </Link>
    );
}

function PairTable({
    rows,
    fromAsset,
    toAsset,
    amount,
    exactOut,
    used,
    symbolOf,
    precisionOf,
}: {
    rows: BanxRelay[];
    fromAsset: number;
    toAsset: number;
    amount: string;
    exactOut: boolean;
    used: Set<string>;
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
}) {
    if (rows.length === 0) {
        return (
            <p className="text-muted-foreground text-sm">
                No relay prices {symbolOf(fromAsset)} and {symbolOf(toAsset)}{" "}
                yet. A path can still convert at a posted fixed rate.
            </p>
        );
    }
    return (
        <div className="grid gap-2">
            <div className="overflow-x-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Relay</TableHead>
                            <TableHead>Reserves</TableHead>
                            <TableHead className="text-right">Fee</TableHead>
                            <TableHead className="text-right">
                                At the relay
                            </TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => {
                            const key = relayKey(
                                row.owner,
                                row.assetLo,
                                row.assetHi,
                            );
                            return (
                                <TableRow key={key}>
                                    <TableCell>
                                        <AccountLink account={row.owner} />
                                    </TableCell>
                                    <TableCell className="font-mono text-sm">
                                        {displayAmount(row.reserveLo)}{" "}
                                        {symbolOf(row.assetLo)}
                                        {" / "}
                                        {displayAmount(row.reserveHi)}{" "}
                                        {symbolOf(row.assetHi)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {ppmToPercent(row.feePpm)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        <CurveQuote
                                            row={row}
                                            fromAsset={fromAsset}
                                            toAsset={toAsset}
                                            amount={amount}
                                            exactOut={exactOut}
                                            precisionOf={precisionOf}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {used.has(key) ? (
                                            <Badge variant="outline">
                                                On this path
                                            </Badge>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            <p className="text-muted-foreground text-xs">
                At the relay is the curve alone. Hop fees can shrink what
                reaches it. Search returns one path.
            </p>
        </div>
    );
}

function PathOutline({
    quote,
    relays,
    symbolOf,
    labelOf,
    recipient,
    fromSymbol,
    toSymbol,
}: {
    quote: PathQuote;
    relays: BanxRelay[];
    symbolOf: (id: number) => string;
    labelOf: (account: string) => string;
    recipient: string;
    fromSymbol: string;
    toSymbol: string;
}) {
    const steps = pathConversions(quote.hops, relays);
    return (
        <div className="grid gap-3">
            <p className="text-sm">
                You send {displayAmount(quote.amountIn)} {fromSymbol}.{" "}
                {who(recipient, labelOf)} receives{" "}
                {displayAmount(quote.amountOut)} {toSymbol}.
            </p>
            {steps.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    This path does not change asset on a relay.
                </p>
            ) : (
                <ul className="grid gap-2 text-sm">
                    {steps.map((step) => (
                        <li key={step.key}>
                            {step.relay ? (
                                <>
                                    Relay posted by {who(step.owner, labelOf)}{" "}
                                    converts {displayAmount(step.input)}{" "}
                                    {symbolOf(step.fromAsset)} and{" "}
                                    {who(step.payee, labelOf)} is drawn for{" "}
                                    {displayAmount(step.output)}{" "}
                                    {symbolOf(step.toAsset)}.
                                </>
                            ) : (
                                <>
                                    {who(step.owner, labelOf)} converts{" "}
                                    {symbolOf(step.fromAsset)} to{" "}
                                    {symbolOf(step.toAsset)} at a fixed rate.{" "}
                                    {who(step.payee, labelOf)} is drawn for{" "}
                                    {displayAmount(step.output)}{" "}
                                    {symbolOf(step.toAsset)}.
                                </>
                            )}
                            {shownAmount(step.hopFee) ? (
                                <>
                                    {" "}
                                    Routing fee {displayAmount(step.hopFee)}{" "}
                                    {symbolOf(step.toAsset)}.
                                </>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function BanxSwap({
    user,
    assets,
    relays,
    relaysLoading,
    symbolOf,
    precisionOf,
    labelOf,
}: {
    user: string | undefined;
    assets: Asset[];
    relays: BanxRelay[];
    relaysLoading: boolean;
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
    labelOf: (account: string) => string;
}) {
    const quotePath = useQuotePath();
    const pathPay = usePathPay();
    const [found, setFound] = useState<{
        key: string;
        quote: PathQuote;
    } | null>(null);
    const [quoteError, setQuoteError] = useState<string | null>(null);

    const form = useAppForm({
        defaultValues: {
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            amount: "",
            recipient: "",
            exactOut: false,
            maxHops: DEFAULT_HOPS,
        },
        onSubmit: async ({ value }) => {
            if (!user) return;
            if (
                value.fromAsset === undefined ||
                value.toAsset === undefined ||
                value.fromAsset === value.toAsset ||
                !value.amount.trim() ||
                !value.recipient.trim()
            ) {
                return;
            }
            if (hopCountError(value.maxHops)) return;
            if (value.recipient.trim() === user) {
                setQuoteError("Pick someone else as the recipient.");
                return;
            }
            const key = [
                user,
                value.recipient.trim(),
                value.fromAsset,
                value.toAsset,
                value.amount.trim(),
                value.exactOut ? "out" : "in",
                hopCount(value.maxHops),
            ].join("|");
            await new Promise<void>((resolve, reject) => {
                quotePath.mutate(
                    {
                        fromAccount: user,
                        toAccount: value.recipient.trim(),
                        amount: value.amount.trim(),
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        maxHops: hopCount(value.maxHops),
                        exactOut: value.exactOut,
                    },
                    {
                        onSuccess: (quote) => {
                            setFound({ key, quote });
                            setQuoteError(null);
                            resolve();
                        },
                        onError: (e: Error) => {
                            setFound(null);
                            setQuoteError(e.message);
                            reject(e);
                        },
                    },
                );
            });
        },
    });

    return (
        <section className="grid gap-4">
            <div>
                <h2 className="font-medium">IOU for IOU</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    Pick the asset you pay and the asset they receive. The
                    table is every relay for that pair. Search finds one path
                    to the recipient and marks the relays on it.
                </p>
            </div>
            <form
                className="grid max-w-3xl gap-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit();
                }}
            >
                <form.Subscribe
                    selector={(s) => s.values}
                    children={(values) => {
                        const from = values.fromAsset;
                        const to = values.toAsset;
                        const ready =
                            from !== undefined &&
                            to !== undefined &&
                            from !== to;
                        const matches = ready
                            ? relays.filter((row) => samePair(row, from, to))
                            : [];
                        const amountPrec = values.exactOut
                            ? to !== undefined
                                ? precisionOf(to)
                                : 0
                            : from !== undefined
                              ? precisionOf(from)
                              : 0;
                        const liveKey = [
                            user ?? "",
                            values.recipient.trim(),
                            from ?? "",
                            to ?? "",
                            values.amount.trim(),
                            values.exactOut ? "out" : "in",
                            hopCount(values.maxHops),
                        ].join("|");
                        const quote =
                            found &&
                            found.key === liveKey &&
                            !hopCountError(values.maxHops)
                                ? found.quote
                                : null;
                        const used = quote
                            ? usedRelayKeys(quote.hops)
                            : new Set<string>();
                        return (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.Field
                                        name="fromAsset"
                                        children={(field) => (
                                            <AssetField
                                                label="You pay"
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) =>
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                    <form.Field
                                        name="toAsset"
                                        children={(field) => (
                                            <AssetField
                                                label="They receive"
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) =>
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                </div>
                                {from !== undefined && from === to ? (
                                    <p className="text-sm text-destructive">
                                        Pick two different assets.
                                    </p>
                                ) : null}
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.AppField
                                        name="amount"
                                        validators={{
                                            onChange: amountFieldValidator(
                                                amountPrec,
                                                { allowZero: false },
                                            ),
                                            onSubmit: amountFieldValidator(
                                                amountPrec,
                                                { allowZero: false },
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label={
                                                    values.exactOut
                                                        ? "They receive"
                                                        : "You send"
                                                }
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    amountPrec,
                                                )}
                                                required
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="recipient"
                                        validators={existingAccountValidators()}
                                        children={(field) => (
                                            <field.TextField
                                                label="Recipient"
                                                description="Someone else. The other asset is delivered to them."
                                                required
                                            />
                                        )}
                                    />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.AppField
                                        name="exactOut"
                                        children={(field) => (
                                            <field.SwitchField
                                                label="Amount is what they receive"
                                                description="Off: the amount is what you send."
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="maxHops"
                                        validators={{
                                            onChange: ({ value }) =>
                                                hopCountError(value),
                                            onSubmit: ({ value }) =>
                                                hopCountError(value),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Max hops"
                                                inputMode="numeric"
                                                description="How far to search, from 1 to 12."
                                            />
                                        )}
                                    />
                                </div>
                                {relaysLoading ? (
                                    <p className="text-muted-foreground text-sm">
                                        Loading relays…
                                    </p>
                                ) : ready ? (
                                    <PairTable
                                        rows={matches}
                                        fromAsset={from}
                                        toAsset={to}
                                        amount={values.amount}
                                        exactOut={values.exactOut}
                                        used={used}
                                        symbolOf={symbolOf}
                                        precisionOf={precisionOf}
                                    />
                                ) : (
                                    <p className="text-muted-foreground text-sm">
                                        Pick two assets to see which relays
                                        price them.
                                    </p>
                                )}
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={["Find path", "Searching…"]}
                                        loading={quotePath.isPending}
                                        disabled={
                                            !user ||
                                            !ready ||
                                            !values.amount.trim() ||
                                            !values.recipient.trim()
                                        }
                                    />
                                </form.AppForm>
                                {quoteError ? (
                                    <p className="text-sm text-destructive" role="alert">
                                        {quoteError}
                                    </p>
                                ) : null}
                                {quote && user && from !== undefined && to !== undefined ? (
                                    <div className="grid gap-3">
                                        <PathRoute
                                            user={user}
                                            hops={quote.hops}
                                            symbolOf={symbolOf}
                                            labelOf={labelOf}
                                        />
                                        <PathOutline
                                            quote={quote}
                                            relays={relays}
                                            symbolOf={symbolOf}
                                            labelOf={labelOf}
                                            recipient={values.recipient.trim()}
                                            fromSymbol={symbolOf(from)}
                                            toSymbol={symbolOf(to)}
                                        />
                                        <Button
                                            type="button"
                                            disabled={pathPay.isPending}
                                            onClick={() => {
                                                pathPay.mutate(
                                                    {
                                                        hops: quote.hops.map(
                                                            (hop) => ({
                                                                account:
                                                                    hop.account,
                                                                assetId:
                                                                    hop.assetId,
                                                            }),
                                                        ),
                                                        amount: quote.amountIn,
                                                        minReturn:
                                                            quote.minReturn,
                                                    },
                                                    {
                                                        onSuccess: () =>
                                                            setFound(null),
                                                    },
                                                );
                                            }}
                                        >
                                            {pathPay.isPending
                                                ? "Paying…"
                                                : "Pay along this path"}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        );
                    }}
                />
            </form>
        </section>
    );
}

function TokenSwap({
    user,
    assets,
    relays,
    relaysLoading,
    symbolOf,
    precisionOf,
    labelOf,
}: {
    user: string | undefined;
    assets: Asset[];
    relays: TokenRelay[];
    relaysLoading: boolean;
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
    labelOf: (account: string) => string;
}) {
    const quotePath = useQuotePath();
    const pathCash = usePathCash();
    const [picked, setPicked] = useState<string | null>(null);
    const [found, setFound] = useState<{
        key: string;
        quote: PathQuote;
    } | null>(null);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const relaysRef = useRef(relays);
    const pickedRef = useRef(picked);
    relaysRef.current = relays;
    pickedRef.current = picked;
    const tokenIds = useMemo(
        () => relays.map((row) => row.tokenId),
        [relays],
    );
    const tokenPrecisions = useTokenPrecisionMap(tokenIds);

    const form = useAppForm({
        defaultValues: {
            assetId: undefined as number | undefined,
            tokenId: "",
            amount: "",
            recipient: "",
            maxHops: DEFAULT_HOPS,
        },
        onSubmit: async ({ value }) => {
            if (!user || value.assetId === undefined) return;
            const tokenId = parseTokenId(value.tokenId);
            if (!tokenId || !value.amount.trim() || !value.recipient.trim()) {
                return;
            }
            if (hopCountError(value.maxHops)) return;
            const relay = chooseTokenRelay(
                relaysRef.current,
                value.assetId,
                tokenId,
                pickedRef.current,
            );
            if (!relay) {
                setQuoteError("Choose a relay.");
                return;
            }
            if (relay.owner === user) {
                setQuoteError(
                    "This relay is yours. Someone else draws on it.",
                );
                return;
            }
            const key = [
                user,
                relay.owner,
                value.recipient.trim(),
                value.assetId,
                tokenId,
                value.amount.trim(),
                hopCount(value.maxHops),
            ].join("|");
            await new Promise<void>((resolve, reject) => {
                quotePath.mutate(
                    {
                        fromAccount: user,
                        toAccount: relay.owner,
                        amount: value.amount.trim(),
                        fromAsset: value.assetId!,
                        toAsset: value.assetId!,
                        maxHops: hopCount(value.maxHops),
                        exactOut: false,
                    },
                    {
                        onSuccess: (quote) => {
                            setFound({ key, quote });
                            setQuoteError(null);
                            resolve();
                        },
                        onError: (e: Error) => {
                            setFound(null);
                            setQuoteError(e.message);
                            reject(e);
                        },
                    },
                );
            });
        },
    });

    return (
        <section className="grid gap-4">
            <div>
                <h2 className="font-medium">IOU for tokens</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    Pick an IOU and a token. Choose whose relay sells
                    it, then search the path that draws them. Their vault pays
                    the tokens to the recipient. That can be you.
                </p>
            </div>
            <form
                className="grid max-w-3xl gap-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit();
                }}
            >
                <form.Subscribe
                    selector={(s) => s.values}
                    children={(values) => {
                        const assetId = values.assetId;
                        const tokenId = parseTokenId(values.tokenId);
                        const matches = matchingTokenRelays(
                            relays,
                            assetId,
                            tokenId,
                        );
                        const chosen = chooseTokenRelay(
                            relays,
                            assetId,
                            tokenId,
                            picked,
                        );
                        const liveKey = [
                            user ?? "",
                            chosen?.owner ?? "",
                            values.recipient.trim(),
                            assetId ?? "",
                            tokenId ?? "",
                            values.amount.trim(),
                            hopCount(values.maxHops),
                        ].join("|");
                        const quote =
                            found &&
                            found.key === liveKey &&
                            !hopCountError(values.maxHops)
                                ? found.quote
                                : null;
                        const banxPrec =
                            assetId !== undefined ? precisionOf(assetId) : 0;
                        const tokenPrec = chosen
                            ? tokenPrecisions.precision.get(chosen.tokenId)
                            : undefined;
                        const lastHop = quote?.hops[quote.hops.length - 1];
                        const landsOnRelay =
                            !!lastHop &&
                            !!chosen &&
                            lastHop.account === chosen.owner &&
                            lastHop.assetId === chosen.assetId;
                        return (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.Field
                                        name="assetId"
                                        children={(field) => (
                                            <AssetField
                                                label="IOU"
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) => {
                                                    field.handleChange(id);
                                                    setPicked(null);
                                                }}
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="tokenId"
                                        validators={{
                                            onChange: ({ value }) =>
                                                value.trim() &&
                                                parseTokenId(value) ===
                                                    undefined
                                                    ? "Enter a token id"
                                                    : undefined,
                                            onSubmit: ({ value }) =>
                                                parseTokenId(value) ===
                                                undefined
                                                    ? "Enter a token id"
                                                    : undefined,
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Token id"
                                                inputMode="numeric"
                                                required
                                            />
                                        )}
                                    />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.AppField
                                        name="amount"
                                        validators={{
                                            onChange: amountFieldValidator(
                                                banxPrec,
                                                { allowZero: false },
                                            ),
                                            onSubmit: amountFieldValidator(
                                                banxPrec,
                                                { allowZero: false },
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="You send"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    banxPrec,
                                                )}
                                                required
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="recipient"
                                        validators={existingAccountValidators()}
                                        children={(field) => (
                                            <field.TextField
                                                label="Token recipient"
                                                description="Who receives the tokens. This can be you."
                                                required
                                            />
                                        )}
                                    />
                                </div>
                                <form.AppField
                                    name="maxHops"
                                    validators={{
                                        onChange: ({ value }) =>
                                            hopCountError(value),
                                        onSubmit: ({ value }) =>
                                            hopCountError(value),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Max hops"
                                            inputMode="numeric"
                                            description="How far to search for the relay owner, from 1 to 12."
                                        />
                                    )}
                                />
                                {relaysLoading ? (
                                    <p className="text-muted-foreground text-sm">
                                        Loading relays…
                                    </p>
                                ) : assetId === undefined ? (
                                    <p className="text-muted-foreground text-sm">
                                        Pick an asset to see token relays.
                                    </p>
                                ) : matches.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        {`No token relay sells ${symbolOf(assetId)}${
                                            tokenId !== undefined
                                                ? ` for token #${tokenId}`
                                                : ""
                                        }.`}
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Relay</TableHead>
                                                    <TableHead>Sells</TableHead>
                                                    <TableHead className="text-right">
                                                        IOU weight
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Token vault
                                                    </TableHead>
                                                    <TableHead className="text-right">
                                                        Fee
                                                    </TableHead>
                                                    <TableHead />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {matches.map((row) => {
                                                    const key = tokenRowKey(row);
                                                    const on =
                                                        chosen !== undefined &&
                                                        tokenRowKey(chosen) ===
                                                            key;
                                                    return (
                                                        <TableRow
                                                            key={key}
                                                            className={cn(
                                                                on && "bg-muted",
                                                            )}
                                                        >
                                                            <TableCell>
                                                                <AccountLink
                                                                    account={
                                                                        row.owner
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell>
                                                                {symbolOf(
                                                                    row.assetId,
                                                                )}{" "}
                                                                → #{row.tokenId}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-sm">
                                                                {displayAmount(
                                                                    row.reserveBanx,
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-sm">
                                                                {displayAmount(
                                                                    row.tokenReserve,
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {ppmToPercent(
                                                                    row.feePpm,
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant={
                                                                        on
                                                                            ? "default"
                                                                            : "outline"
                                                                    }
                                                                    onClick={() =>
                                                                        setPicked(
                                                                            key,
                                                                        )
                                                                    }
                                                                >
                                                                    {on
                                                                        ? "Selected"
                                                                        : "Use"}
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={["Find path", "Searching…"]}
                                        loading={quotePath.isPending}
                                        disabled={
                                            !user ||
                                            !chosen ||
                                            chosen.owner === user ||
                                            !values.amount.trim() ||
                                            !values.recipient.trim()
                                        }
                                    />
                                </form.AppForm>
                                {quoteError ? (
                                    <p className="text-sm text-destructive" role="alert">
                                        {quoteError}
                                    </p>
                                ) : null}
                                {quote && user && chosen ? (
                                    <div className="grid gap-3">
                                        <PathRoute
                                            user={user}
                                            hops={quote.hops}
                                            symbolOf={symbolOf}
                                            labelOf={labelOf}
                                        />
                                        <p className="text-sm">
                                            You send{" "}
                                            {displayAmount(quote.amountIn)}{" "}
                                            {symbolOf(chosen.assetId)} along
                                            this path.{" "}
                                            {who(chosen.owner, labelOf)} is
                                            drawn for{" "}
                                            {displayAmount(quote.amountOut)}.
                                        </p>
                                        <TokenCurvePay
                                                reserveIn={humanToRaw(
                                                    chosen.reserveBanx,
                                                    banxPrec,
                                                )}
                                                reserveOut={
                                                    tokenPrec === undefined
                                                        ? 0n
                                                        : humanToRaw(
                                                              chosen.tokenReserve,
                                                              tokenPrec,
                                                          )
                                                }
                                                amountIn={humanToRaw(
                                                    quote.amountOut,
                                                    banxPrec,
                                                )}
                                                feePpm={chosen.feePpm}
                                                tokenPrec={tokenPrec}
                                                precisionFailed={tokenPrecisions.failed.has(
                                                    chosen.tokenId,
                                                )}
                                                tokenId={chosen.tokenId}
                                                recipient={who(
                                                    values.recipient.trim(),
                                                    labelOf,
                                                )}
                                                canPay={landsOnRelay}
                                                pending={pathCash.isPending}
                                                onPay={(tokensOut) => {
                                                    if (tokenPrec === undefined) {
                                                        return;
                                                    }
                                                    pathCash.mutate(
                                                        {
                                                            hops: quote.hops.map(
                                                                (hop) => ({
                                                                    account:
                                                                        hop.account,
                                                                    assetId:
                                                                        hop.assetId,
                                                                }),
                                                            ),
                                                            amount: quote.amountIn,
                                                            tokenId:
                                                                chosen.tokenId,
                                                            recipient:
                                                                values.recipient.trim(),
                                                            minTokens: rawToFixed(
                                                                tokensOut,
                                                                tokenPrec,
                                                            ),
                                                        },
                                                        {
                                                            onSuccess: () =>
                                                                setFound(null),
                                                        },
                                                    );
                                                }}
                                            />
                                        {landsOnRelay ? null : (
                                            <p className="text-sm text-destructive">
                                                This path does not draw{" "}
                                                {who(chosen.owner, labelOf)}.
                                            </p>
                                        )}
                                    </div>
                                ) : null}
                            </>
                        );
                    }}
                />
            </form>
        </section>
    );
}

function PostBanx({
    assets,
    mine,
    symbolOf,
    precisionOf,
}: {
    assets: Asset[];
    mine: BanxRelay[];
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
}) {
    const setRelay = useSetRelay();
    const removeRelay = useRemoveRelay();
    const form = useAppForm({
        defaultValues: {
            assetA: undefined as number | undefined,
            assetB: undefined as number | undefined,
            reserveA: "",
            reserveB: "",
            feePct: "0",
        },
        onSubmit: async ({ value }) => {
            if (
                value.assetA === undefined ||
                value.assetB === undefined ||
                value.assetA === value.assetB ||
                !value.reserveA.trim() ||
                !value.reserveB.trim()
            ) {
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setRelay.mutate(
                    {
                        assetA: value.assetA!,
                        assetB: value.assetB!,
                        reserveA: value.reserveA.trim(),
                        reserveB: value.reserveB.trim(),
                        feePpm: percentStringToPpm(
                            value.feePct,
                            MAX_HOP_FEE_PPM,
                        ),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    return (
        <section className="grid max-w-3xl gap-4">
            <div>
                <h2 className="font-medium">Post an IOU relay</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    Both reserves are virtual weights of equal market value.
                    Posting them creates no claim. A fill leaves you owed the
                    input by the previous hop and owing the next hop only the
                    curve output. Posting again replaces the weights. One
                    relay per pair.
                </p>
            </div>
            <form
                className="grid gap-4 rounded-xl border p-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit();
                }}
            >
                <form.Subscribe
                    selector={(s) => s.values}
                    children={(values) => {
                        const precA =
                            values.assetA !== undefined
                                ? precisionOf(values.assetA)
                                : 0;
                        const precB =
                            values.assetB !== undefined
                                ? precisionOf(values.assetB)
                                : 0;
                        return (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.Field
                                        name="assetA"
                                        children={(field) => (
                                            <AssetField
                                                label="Asset A"
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) =>
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                    <form.Field
                                        name="assetB"
                                        children={(field) => (
                                            <AssetField
                                                label="Asset B"
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) =>
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                </div>
                                {values.assetA !== undefined &&
                                values.assetA === values.assetB ? (
                                    <p className="text-sm text-destructive">
                                        Pick two different assets.
                                    </p>
                                ) : null}
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.AppField
                                        name="reserveA"
                                        validators={{
                                            onChange: amountFieldValidator(
                                                precA,
                                                { allowZero: false },
                                            ),
                                            onSubmit: amountFieldValidator(
                                                precA,
                                                { allowZero: false },
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Reserve A"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    precA,
                                                )}
                                                required
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="reserveB"
                                        validators={{
                                            onChange: amountFieldValidator(
                                                precB,
                                                { allowZero: false },
                                            ),
                                            onSubmit: amountFieldValidator(
                                                precB,
                                                { allowZero: false },
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Reserve B"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    precB,
                                                )}
                                                required
                                            />
                                        )}
                                    />
                                </div>
                                {values.assetA !== undefined &&
                                values.assetB !== undefined &&
                                values.assetA !== values.assetB
                                    ? (() => {
                                          const prices = relayUnitPrices(
                                              values.reserveA,
                                              values.reserveB,
                                          );
                                          if (!prices) return null;
                                          const symA = symbolOf(
                                              values.assetA,
                                          ).toUpperCase();
                                          const symB = symbolOf(
                                              values.assetB,
                                          ).toUpperCase();
                                          return (
                                              <div className="text-muted-foreground space-y-2 text-sm">
                                                  <div className="flex justify-between gap-4">
                                                      <span>
                                                          {symA} price
                                                      </span>
                                                      <span>
                                                          {prices.aInB} {symB}
                                                      </span>
                                                  </div>
                                                  <div className="flex justify-between gap-4">
                                                      <span>
                                                          {symB} price
                                                      </span>
                                                      <span>
                                                          {prices.bInA} {symA}
                                                      </span>
                                                  </div>
                                              </div>
                                          );
                                      })()
                                    : null}
                                <form.AppField
                                    name="feePct"
                                    validators={{
                                        onChange: percentFieldValidator(
                                            MAX_HOP_FEE_PERCENT,
                                        ),
                                        onSubmit: percentFieldValidator(
                                            MAX_HOP_FEE_PERCENT,
                                        ),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Fee %"
                                            inputMode="decimal"
                                            description="Taken from the input before the curve. Under 100%."
                                            required
                                        />
                                    )}
                                />
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={["Post relay", "Posting…"]}
                                        loading={setRelay.isPending}
                                        disabled={
                                            values.assetA === undefined ||
                                            values.assetB === undefined ||
                                            values.assetA === values.assetB ||
                                            !values.reserveA.trim() ||
                                            !values.reserveB.trim()
                                        }
                                    />
                                </form.AppForm>
                            </>
                        );
                    }}
                />
            </form>
            {mine.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    You have not posted an IOU relay.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Pair</TableHead>
                                <TableHead className="text-right">
                                    Reserves
                                </TableHead>
                                <TableHead className="text-right">
                                    Fee
                                </TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mine.map((row) => (
                                <TableRow
                                    key={relayKey(
                                        row.owner,
                                        row.assetLo,
                                        row.assetHi,
                                    )}
                                >
                                    <TableCell>
                                        {symbolOf(row.assetLo)} /{" "}
                                        {symbolOf(row.assetHi)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {displayAmount(row.reserveLo)} /{" "}
                                        {displayAmount(row.reserveHi)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {ppmToPercent(row.feePpm)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={removeRelay.isPending}
                                            onClick={() =>
                                                removeRelay.mutate({
                                                    assetA: row.assetLo,
                                                    assetB: row.assetHi,
                                                })
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            <p className="text-muted-foreground text-xs">
                Removing a relay leaves claims already drawn.
            </p>
        </section>
    );
}

function PostToken({
    assets,
    mine,
    symbolOf,
    precisionOf,
}: {
    assets: Asset[];
    mine: TokenRelay[];
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
}) {
    const setRelay = useSetTokenRelay();
    const removeRelay = useRemoveTokenRelay();
    const form = useAppForm({
        defaultValues: {
            assetId: undefined as number | undefined,
            tokenId: "",
            reserveBanx: "",
            feePct: "0",
        },
        onSubmit: async ({ value }) => {
            const tokenId = parseTokenId(value.tokenId);
            if (
                value.assetId === undefined ||
                tokenId === undefined ||
                !value.reserveBanx.trim()
            ) {
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setRelay.mutate(
                    {
                        assetId: value.assetId!,
                        tokenId,
                        reserveBanx: value.reserveBanx.trim(),
                        feePpm: percentStringToPpm(
                            value.feePct,
                            MAX_HOP_FEE_PPM,
                        ),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    return (
        <section className="grid max-w-3xl gap-4">
            <div>
                <h2 className="font-medium">Post a token relay</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    The IOU reserve is a virtual weight. The token side is
                    your cash vault for that token. Fund it on{" "}
                    <Link to="/cash" className="underline">
                        Cash.
                    </Link>{" "}
                    One vault backs one relay.
                </p>
            </div>
            <form
                className="grid gap-4 rounded-xl border p-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit();
                }}
            >
                <form.Subscribe
                    selector={(s) => s.values}
                    children={(values) => {
                        const prec =
                            values.assetId !== undefined
                                ? precisionOf(values.assetId)
                                : 0;
                        return (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.Field
                                        name="assetId"
                                        children={(field) => (
                                            <AssetField
                                                label="IOU"
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) =>
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="tokenId"
                                        validators={{
                                            onSubmit: ({ value }) =>
                                                parseTokenId(value) ===
                                                undefined
                                                    ? "Enter a token id"
                                                    : undefined,
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Token id"
                                                inputMode="numeric"
                                                required
                                            />
                                        )}
                                    />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <form.AppField
                                        name="reserveBanx"
                                        validators={{
                                            onChange: amountFieldValidator(
                                                prec,
                                                { allowZero: false },
                                            ),
                                            onSubmit: amountFieldValidator(
                                                prec,
                                                { allowZero: false },
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="IOU reserve"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    prec,
                                                )}
                                                required
                                            />
                                        )}
                                    />
                                    <form.AppField
                                        name="feePct"
                                        validators={{
                                            onChange: percentFieldValidator(
                                                MAX_HOP_FEE_PERCENT,
                                            ),
                                            onSubmit: percentFieldValidator(
                                                MAX_HOP_FEE_PERCENT,
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Fee %"
                                                inputMode="decimal"
                                                required
                                            />
                                        )}
                                    />
                                </div>
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={[
                                            "Post token relay",
                                            "Posting…",
                                        ]}
                                        loading={setRelay.isPending}
                                        disabled={
                                            values.assetId === undefined ||
                                            parseTokenId(values.tokenId) ===
                                                undefined ||
                                            !values.reserveBanx.trim()
                                        }
                                    />
                                </form.AppForm>
                            </>
                        );
                    }}
                />
            </form>
            {mine.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    You have not posted a token relay.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Sells</TableHead>
                                <TableHead className="text-right">
                                    IOU weight
                                </TableHead>
                                <TableHead className="text-right">
                                    Token vault
                                </TableHead>
                                <TableHead className="text-right">
                                    Fee
                                </TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mine.map((row) => (
                                <TableRow
                                    key={`${row.assetId}:${row.tokenId}`}
                                >
                                    <TableCell>
                                        {symbolOf(row.assetId)} → #
                                        {row.tokenId}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {displayAmount(row.reserveBanx)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {displayAmount(row.tokenReserve)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {ppmToPercent(row.feePpm)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={removeRelay.isPending}
                                            onClick={() =>
                                                removeRelay.mutate({
                                                    assetId: row.assetId,
                                                    tokenId: row.tokenId,
                                                })
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            <p className="text-muted-foreground text-xs">
                Removing a token relay leaves the tokens in the vault and
                leaves claims already drawn.
            </p>
        </section>
    );
}

export function RelaysPage() {
    const { data: user } = useCurrentUser();
    const { label } = useBanxContacts("/relays");
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const {
        data: relays = [],
        isLoading: relaysLoading,
        isError: relaysError,
    } = useBanxRelays();
    const {
        data: tokenRelays = [],
        isLoading: tokenLoading,
        isError: tokenError,
    } = useTokenRelays();
    const mine = relays.filter((row) => row.owner === user);
    const myTokens = tokenRelays.filter((row) => row.owner === user);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Relays"
                description="Post a constant-product relay, or pick two assets and follow the path that delivers the other one."
            />
            {relaysError || tokenError ? (
                <p className="text-sm text-destructive" role="alert">
                    Couldn't load relays.
                </p>
            ) : null}
            <Tabs defaultValue="swap">
                <TabsList>
                    <TabsTrigger value="swap">Swap</TabsTrigger>
                    <TabsTrigger value="post">Post</TabsTrigger>
                </TabsList>
                <TabsContent value="swap" className="mt-6 space-y-10">
                    <BanxSwap
                        user={user ?? undefined}
                        assets={assets}
                        relays={relays}
                        relaysLoading={relaysLoading}
                        symbolOf={symbolOf}
                        precisionOf={precisionOf}
                        labelOf={label}
                    />
                    <TokenSwap
                        user={user ?? undefined}
                        assets={assets}
                        relays={tokenRelays}
                        relaysLoading={tokenLoading}
                        symbolOf={symbolOf}
                        precisionOf={precisionOf}
                        labelOf={label}
                    />
                </TabsContent>
                <TabsContent value="post" className="mt-6 space-y-10">
                    <PostBanx
                        assets={assets}
                        mine={mine}
                        symbolOf={symbolOf}
                        precisionOf={precisionOf}
                    />
                    <PostToken
                        assets={assets}
                        mine={myTokens}
                        symbolOf={symbolOf}
                        precisionOf={precisionOf}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
