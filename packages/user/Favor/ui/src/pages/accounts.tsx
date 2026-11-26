import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLocalStorage } from "usehooks-ts";
import NumberFlow from "@number-flow/react";

import { ChevronRight, GitBranch, Handshake, Plus, Route } from "lucide-react";

import { ActivityFeed } from "@/components/activity-feed";
import { ClaimedInviteNicks } from "@/components/claimed-invite-nicks";
import { CreditLineDialog } from "@/components/credit-line-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { transferPrefillFromSearch } from "@/lib/transfer-url";
import { NewDepositLoanDialog } from "@/components/new-deposit-loan-dialog";
import { PageHeader } from "@/components/page-header";
import { PositionSummary } from "@/components/position-summary";
import { defaultAssetId } from "@/components/asset-select";
import {
    RoutingPolicyDialog,
    type RoutingPolicyPrefill,
} from "@/components/routing-policy-dialog";
import {
    BuyClaimOfferDialog,
    type BuyClaimPrefill,
} from "@/components/buy-claim-offer-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import { useAccountGroups } from "@/hooks/use-account-groups";
import { useFavorContacts } from "@/hooks/use-favor-contacts";
import { useForwardOffers, useBuyClaimOffers } from "@/hooks/use-favor-data";
import { useInvalidateLedger } from "@/hooks/use-favor-mutations";
import {
    accountHref,
    creditExtendedRaw,
    drawableRaw,
    groupsInAsset,
    mergeCounterparties,
    otherCurrenciesWithBalance,
    positionTotals,
    type CounterpartyRow,
} from "@/lib/account-groups";
import {
    formatRawAmount,
    humanToRaw,
    isIsoCurrency,
    moneyFormatOptions,
    rawToNumber,
} from "@/lib/amount";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { Separator } from "@shared/shadcn/ui/separator";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

const RECENT_ACTIVITY = 5;

export function AccountsPage() {
    const { label } = useFavorContacts("/accounts");
    const [searchParams, setSearchParams] = useSearchParams();
    const urlTransferPrefill = useMemo(
        () => transferPrefillFromSearch(searchParams),
        [searchParams],
    );
    const [transferOpen, setTransferOpen] = useState(!!urlTransferPrefill);
    useEffect(() => {
        if (urlTransferPrefill) setTransferOpen(true);
    }, [urlTransferPrefill]);
    const {
        savings: savingsAll,
        loans: loansAll,
        isLoading,
        isError,
    } = useAccountGroups();
    const refresh = useInvalidateLedger();
    const { data: forwardOffers = [] } = useForwardOffers();
    const { data: buyClaimOffers = [] } = useBuyClaimOffers();
    const { assets, byId, symbolOf, precisionOf } = useAssetMap();

    const nowSec = Math.floor(Date.now() / 1000);

    const [createOpen, setCreateOpen] = useState(false);
    const [creditLineOpen, setCreditLineOpen] = useState(false);
    const [routingOpen, setRoutingOpen] = useState(false);
    const [routingPrefill, setRoutingPrefill] =
        useState<RoutingPolicyPrefill | null>(null);
    const [buyClaimOpen, setBuyClaimOpen] = useState(false);
    const [buyClaimPrefill, setBuyClaimPrefill] =
        useState<BuyClaimPrefill | null>(null);
    // A new key: the old per-side keys defaulted to hiding, and a line you
    // just offered has no balance, so it vanished from the list.
    const [hideEmpty, setHideEmpty] = useLocalStorage(
        "favor.accounts.hideEmpty",
        false,
    );
    const [storedAssetId, setStoredAssetId] = useLocalStorage<number | null>(
        "favor.accounts.assetId",
        null,
    );
    const selectedAssetId = useMemo(() => {
        if (
            storedAssetId != null &&
            assets.some((a) => a.id === storedAssetId)
        ) {
            return storedAssetId;
        }
        return defaultAssetId(assets);
    }, [assets, storedAssetId]);
    const currencySymbol =
        selectedAssetId !== undefined ? symbolOf(selectedAssetId) : "";
    const currencyPrecision =
        selectedAssetId !== undefined ? precisionOf(selectedAssetId) : 0;
    const globalForwardOn = useMemo(
        () =>
            selectedAssetId !== undefined &&
            forwardOffers.some(
                (p) =>
                    p.isGlobal &&
                    p.assetId === selectedAssetId &&
                    (p.expiresAt === 0 || p.expiresAt >= nowSec),
            ),
        [forwardOffers, nowSec, selectedAssetId],
    );
    const globalBuyClaimOn = useMemo(() => {
        if (
            selectedAssetId === undefined ||
            !byId.has(selectedAssetId)
        ) {
            return false;
        }
        const precision = precisionOf(selectedAssetId);
        return buyClaimOffers.some(
            (p) =>
                p.isGlobal &&
                p.isBuy &&
                p.assetId === selectedAssetId &&
                (p.expiresAt === 0 || p.expiresAt >= nowSec) &&
                humanToRaw(p.remaining, precision) > 0n,
        );
    }, [buyClaimOffers, byId, nowSec, precisionOf, selectedAssetId]);

    const openRouting = (prefill?: RoutingPolicyPrefill | null) => {
        setRoutingPrefill(prefill ?? null);
        setRoutingOpen(true);
    };

    const openBuyClaim = (prefill?: BuyClaimPrefill | null) => {
        setBuyClaimPrefill(prefill ?? null);
        setBuyClaimOpen(true);
    };

    const savingsInCurrency = useMemo(
        () => groupsInAsset(savingsAll, selectedAssetId),
        [savingsAll, selectedAssetId],
    );
    const loansInCurrency = useMemo(
        () => groupsInAsset(loansAll, selectedAssetId),
        [loansAll, selectedAssetId],
    );
    const rowsInCurrency = useMemo(
        () => mergeCounterparties(savingsInCurrency, loansInCurrency),
        [savingsInCurrency, loansInCurrency],
    );
    const emptyCount = useMemo(
        () => rowsInCurrency.filter((r) => !r.hasBalance).length,
        [rowsInCurrency],
    );
    const rows = useMemo(
        () =>
            hideEmpty
                ? rowsInCurrency.filter((r) => r.hasBalance)
                : rowsInCurrency,
        [rowsInCurrency, hideEmpty],
    );
    const position = useMemo(
        () => positionTotals(savingsInCurrency, loansInCurrency),
        [savingsInCurrency, loansInCurrency],
    );
    const creditLimit = useMemo(() => {
        if (selectedAssetId === undefined) return 0n;
        return creditExtendedRaw(loansInCurrency, currencyPrecision);
    }, [loansInCurrency, currencyPrecision, selectedAssetId]);
    const otherCurrencies = useMemo(
        () =>
            otherCurrenciesWithBalance(savingsAll, loansAll, selectedAssetId),
        [savingsAll, loansAll, selectedAssetId],
    );

    return (
        <div className="space-y-6 overflow-x-hidden sm:space-y-8">
            <PageHeader
                title="Accounts"
                description="What others owe you and what you owe, one currency at a time."
                action={
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <Button
                            type="button"
                            className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                            onClick={() => setTransferOpen(true)}
                        >
                            <GitBranch className="size-4" />
                            Transfer
                        </Button>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                        "min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none",
                                        globalForwardOn
                                            ? "border-emerald-500/60 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                                            : "border-red-500/70 text-red-700 hover:bg-red-500/10 dark:text-red-400",
                                    )}
                                    aria-label={
                                        globalForwardOn
                                            ? "Forwarding is on — click to edit"
                                            : "Forwarding is off — click to turn it on"
                                    }
                                    onClick={() =>
                                        openRouting(
                                            selectedAssetId !== undefined
                                                ? { assetId: selectedAssetId }
                                                : null,
                                        )
                                    }
                                >
                                    <Route className="size-4" />
                                    Forward
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                {globalForwardOn
                                    ? "Forwarding is on. Friends can pay through you."
                                    : "Forwarding is off. Friends cannot pay through you until you turn it on."}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                        "min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none",
                                        globalBuyClaimOn
                                            ? "border-emerald-500/60 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                                            : "border-red-500/70 text-red-700 hover:bg-red-500/10 dark:text-red-400",
                                    )}
                                    aria-label={
                                        globalBuyClaimOn
                                            ? "Global buy-claim offer is on — click to edit"
                                            : "Global buy-claim offer is off — click to post one"
                                    }
                                    onClick={() =>
                                        openBuyClaim(
                                            selectedAssetId !== undefined
                                                ? { assetId: selectedAssetId }
                                                : null,
                                        )
                                    }
                                >
                                    <Handshake className="size-4" />
                                    Buy claims
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                {globalBuyClaimOn
                                    ? "Global buy-claim on — others can sell you claims. Click to edit."
                                    : "No global buy-claim — post one to buy others' claims."}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                }
            />

            <div className="space-y-3">
                <PositionSummary
                    assets={assets}
                    assetId={selectedAssetId}
                    onAssetId={setStoredAssetId}
                    held={position.assets}
                    owed={position.liabilities}
                    limit={creditLimit}
                    precision={currencyPrecision}
                    symbol={currencySymbol}
                    isLoading={isLoading || isError}
                />
                <OtherCurrencies
                    ids={otherCurrencies}
                    symbolOf={symbolOf}
                    onSelect={setStoredAssetId}
                />
            </div>

            <TransferDialog
                open={transferOpen}
                onOpenChange={(open) => {
                    setTransferOpen(open);
                    if (!open && urlTransferPrefill) {
                        setSearchParams({}, { replace: true });
                    }
                }}
                prefill={urlTransferPrefill}
                defaultAsset={selectedAssetId}
            />

            <RoutingPolicyDialog
                open={routingOpen}
                onOpenChange={(open) => {
                    setRoutingOpen(open);
                    if (!open) setRoutingPrefill(null);
                }}
                assets={assets}
                prefill={routingPrefill}
            />

            <BuyClaimOfferDialog
                open={buyClaimOpen}
                onOpenChange={(open) => {
                    setBuyClaimOpen(open);
                    if (!open) setBuyClaimPrefill(null);
                }}
                assets={assets}
                prefill={buyClaimPrefill}
            />

            <CreditLineDialog
                open={creditLineOpen}
                onOpenChange={setCreditLineOpen}
                assets={assets}
                precisionOf={precisionOf}
                editing={null}
                assetId={selectedAssetId}
            />

            <NewDepositLoanDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                assets={assets}
                precisionOf={precisionOf}
                assetId={selectedAssetId}
            />

            <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold tracking-tight sm:text-lg">
                            Balances
                            {rows.length > 0 ? (
                                <Badge
                                    variant="secondary"
                                    className="ml-2 align-middle"
                                >
                                    {rows.length}
                                </Badge>
                            ) : null}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            Who owes whom
                            {currencySymbol ? ` in ${currencySymbol}` : ""}. Tap
                            an account for details.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {emptyCount > 0 || hideEmpty ? (
                            <div className="flex items-center gap-2 pr-1">
                                <Label
                                    htmlFor="hide-empty"
                                    className="text-muted-foreground text-xs font-normal"
                                >
                                    Hide empty ({emptyCount})
                                </Label>
                                <Switch
                                    id="hide-empty"
                                    checked={hideEmpty}
                                    onCheckedChange={setHideEmpty}
                                    aria-label="Hide credit lines with no balance"
                                />
                            </div>
                        ) : null}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="min-h-11 gap-1.5 sm:min-h-8"
                                    aria-label="Offer a credit line"
                                    onClick={() => setCreditLineOpen(true)}
                                >
                                    <Plus className="size-4" />
                                    Credit line
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                Let someone owe you, up to a limit you choose.
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="min-h-11 gap-1.5 sm:min-h-8"
                                    aria-label="Book a deposit"
                                    onClick={() => setCreateOpen(true)}
                                >
                                    <Plus className="size-4" />
                                    Deposit
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                Record value you received outside Favor. You owe
                                the depositor.
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                <ClaimedInviteNicks returnPath="/accounts" />

                {isLoading ? (
                    <AccountsSkeleton />
                ) : isError ? (
                    <div
                        role="alert"
                        className="border-destructive/40 flex items-center justify-between gap-3 rounded-xl border p-4"
                    >
                        <p className="text-destructive text-sm">
                            Could not load your accounts.
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={refresh}
                        >
                            Retry
                        </Button>
                    </div>
                ) : rows.length === 0 ? (
                    <EmptyAccounts
                        symbol={currencySymbol}
                        hiddenCount={emptyCount}
                        onShowHidden={() => setHideEmpty(false)}
                    />
                ) : (
                    <div className="divide-y overflow-hidden rounded-xl border">
                        {rows.map((row) => (
                            <AccountRow
                                key={row.key}
                                row={row}
                                title={label(row.counterparty)}
                                symbol={symbolOf(row.assetId)}
                                precision={precisionOf(row.assetId)}
                            />
                        ))}
                    </div>
                )}
            </section>

            <Separator />

            <section className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                    <h2 className="text-base font-semibold tracking-tight sm:text-lg">
                        Recent activity
                    </h2>
                    <Link
                        to="/history"
                        className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
                    >
                        View all
                    </Link>
                </div>
                <ActivityFeed
                    assetId={selectedAssetId}
                    limit={RECENT_ACTIVITY}
                    showFilters={false}
                />
            </section>
        </div>
    );
}

function OtherCurrencies({
    ids,
    symbolOf,
    onSelect,
}: {
    ids: number[];
    symbolOf: (id: number) => string;
    onSelect: (id: number) => void;
}) {
    if (ids.length === 0) return null;
    const shown = ids.slice(0, 3);
    const more = ids.length - shown.length;
    return (
        <p className="text-muted-foreground text-sm">
            You also have balances in{" "}
            {shown.map((id, i) => (
                <span key={id}>
                    {i > 0 ? ", " : ""}
                    <button
                        type="button"
                        className="text-foreground underline underline-offset-4"
                        onClick={() => onSelect(id)}
                    >
                        {symbolOf(id)}
                    </button>
                </span>
            ))}
            {more > 0 ? ` and ${more} more` : ""}.
        </p>
    );
}

function AccountRow({
    row,
    title,
    symbol,
    precision,
}: {
    row: CounterpartyRow;
    title: string;
    symbol: string;
    precision: number;
}) {
    const owed = row.net > 0n;
    const owing = row.net < 0n;
    const amount = owing ? -row.net : row.net;
    const format = moneyFormatOptions(symbol, precision);
    const ticker =
        !isIsoCurrency(symbol) && symbol ? (
            <span className="text-muted-foreground ml-1 text-xs font-sans font-normal sm:ml-1.5 sm:text-sm">
                {symbol}
            </span>
        ) : null;
    const offered = row.lineToThem
        ? humanToRaw(row.lineToThem.limit || "0", precision)
        : null;
    const drawable = drawableRaw(row.lineFromThem, row.youOwe, precision);
    const amountCls = owed
        ? "text-emerald-800 dark:text-emerald-300"
        : owing
          ? "text-amber-900 dark:text-amber-300"
          : "text-muted-foreground";
    const caption = owed ? "Owed to you" : owing ? "You owe" : "Even";

    return (
        <Link
            to={accountHref(row.counterparty)}
            className="hover:bg-muted/40 flex items-center gap-3 px-3 py-3 transition-colors sm:px-4 sm:py-4"
        >
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold tracking-tight">
                        {title}
                    </span>
                    {title !== row.counterparty ? (
                        <span className="text-muted-foreground truncate text-xs">
                            {row.counterparty}
                        </span>
                    ) : null}
                </div>
                {drawable !== undefined || offered !== null || !row.hasBalance ? (
                    <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                        {[
                            drawable !== undefined
                                ? `You can draw ${formatRawAmount(drawable.toString(), precision)}`
                                : null,
                            offered !== null
                                ? `You offered up to ${formatRawAmount(offered.toString(), precision)}`
                                : null,
                            !row.hasBalance ? "No balance" : null,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                ) : null}
            </div>
            <div className="shrink-0 text-right">
                <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase sm:text-xs">
                    {caption}
                </p>
                <p className="text-lg font-semibold tracking-tight sm:text-2xl">
                    <NumberFlow
                        value={rawToNumber(amount, precision)}
                        locales="en"
                        format={format}
                        className={cn("whitespace-nowrap", amountCls)}
                    />
                    {ticker}
                </p>
            </div>
            <ChevronRight
                aria-hidden
                className="text-muted-foreground size-4 shrink-0"
            />
        </Link>
    );
}

function AccountsSkeleton() {
    return (
        <div
            className="divide-y overflow-hidden rounded-xl border"
            aria-busy="true"
            aria-label="Loading accounts"
        >
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="flex items-center justify-between gap-3 px-3 py-4 sm:px-4"
                >
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                </div>
            ))}
        </div>
    );
}

function EmptyAccounts({
    symbol,
    hiddenCount,
    onShowHidden,
}: {
    symbol: string;
    hiddenCount: number;
    onShowHidden: () => void;
}) {
    const hidden = hiddenCount > 0;
    const currency = symbol ? `${symbol} ` : "";
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
            <p className="font-medium">
                {hidden
                    ? `No ${currency}balances`
                    : `No ${currency}accounts yet`}
            </p>
            <p className="text-muted-foreground max-w-md text-sm">
                {hidden
                    ? `${hiddenCount} credit line${hiddenCount === 1 ? "" : "s"} with no balance ${hiddenCount === 1 ? "is" : "are"} hidden.`
                    : "Offer a credit line so someone can draw on you, or book a deposit. Balances show up here once value moves."}
            </p>
            {hidden ? (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onShowHidden}
                >
                    Show them
                </Button>
            ) : null}
        </div>
    );
}
