import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLocalStorage } from "usehooks-ts";

import {
    Building2,
    GitBranch,
    History,
    PiggyBank,
    Handshake,
    KeyRound,
    Plus,
    Route,
} from "lucide-react";

import { ActivityFeed } from "@/components/activity-feed";
import { ClaimedInviteNicks } from "@/components/claimed-invite-nicks";
import { CreditLineDialog } from "@/components/credit-line-dialog";
import {
    TransferDialog,
    transferPrefillFromSearch,
} from "@/components/transfer-dialog";
import { BookAuthDialog } from "@/components/book-auth-dialog";
import { NewDepositLoanDialog } from "@/components/new-deposit-loan-dialog";
import { PageHeader } from "@/components/page-header";
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
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import { useForwardOffers, useBuyClaimOffers } from "@/hooks/use-banx-data";
import {
    accountHref,
    filterGroups,
    isFacilityOnly,
    type GroupedAccount,
} from "@/lib/account-groups";
import { formatRawAmount, humanToRaw, lineAvailableRaw } from "@/lib/amount";
import type { BookAuth, CreditLine } from "@/lib/graphql";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { Separator } from "@shared/shadcn/ui/separator";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

export function ObligationsPage() {
    const { label } = useBanxContacts("/accounts");
    const [searchParams, setSearchParams] = useSearchParams();
    const urlTransferPrefill = useMemo(
        () => transferPrefillFromSearch(searchParams),
        [searchParams],
    );
    const [transferOpen, setTransferOpen] = useState(!!urlTransferPrefill);
    useEffect(() => {
        if (urlTransferPrefill) setTransferOpen(true);
    }, [urlTransferPrefill]);
    const { savings: savingsGroupsAll, loans: loanGroupsAll, isLoading } =
        useAccountGroups();
    const { data: forwardOffers = [] } = useForwardOffers();
    const { data: buyClaimOffers = [] } = useBuyClaimOffers();
    const { assets, symbolOf, precisionOf } = useAssetMap();

    const nowSec = Math.floor(Date.now() / 1000);
    const globalForwardOn = useMemo(
        () =>
            forwardOffers.some(
                (p) => p.isGlobal && (p.expiresAt === 0 || p.expiresAt >= nowSec),
            ),
        [forwardOffers, nowSec],
    );
    const globalBuyClaimOn = useMemo(
        () =>
            buyClaimOffers.some(
                (p) => p.isGlobal && (p.expiresAt === 0 || p.expiresAt >= nowSec),
            ),
        [buyClaimOffers, nowSec],
    );

    const [createOpen, setCreateOpen] = useState(false);
    const [creditLineOpen, setCreditLineOpen] = useState(false);
    const [editingLine, setEditingLine] = useState<CreditLine | null>(null);
    const [routingOpen, setRoutingOpen] = useState(false);
    const [routingPrefill, setRoutingPrefill] =
        useState<RoutingPolicyPrefill | null>(null);
    const [buyClaimOpen, setBuyClaimOpen] = useState(false);
    const [buyClaimPrefill, setBuyClaimPrefill] =
        useState<BuyClaimPrefill | null>(null);
    const [bookAuthOpen, setBookAuthOpen] = useState(false);
    const [bookAuthPrefill, setBookAuthPrefill] = useState<{
        creditor?: string;
        assetId?: number;
    } | null>(null);
    const [editingBookAuth, setEditingBookAuth] = useState<BookAuth | null>(
        null,
    );
    const [hideEmptySavings, setHideEmptySavings] = useLocalStorage(
        "banx.accounts.hideEmptySavings",
        true,
    );
    const [hideEmptyLoans, setHideEmptyLoans] = useLocalStorage(
        "banx.accounts.hideEmptyLoans",
        true,
    );

    const openRouting = (prefill?: RoutingPolicyPrefill | null) => {
        setRoutingPrefill(prefill ?? null);
        setRoutingOpen(true);
    };

    const openBuyClaim = (prefill?: BuyClaimPrefill | null) => {
        setBuyClaimPrefill(prefill ?? null);
        setBuyClaimOpen(true);
    };

    const savingsGroups = useMemo(
        () => filterGroups(savingsGroupsAll, hideEmptySavings),
        [savingsGroupsAll, hideEmptySavings],
    );
    const loanGroups = useMemo(
        () => filterGroups(loanGroupsAll, hideEmptyLoans),
        [loanGroupsAll, hideEmptyLoans],
    );

    const savingsFacilityCount = useMemo(
        () => savingsGroupsAll.filter(isFacilityOnly).length,
        [savingsGroupsAll],
    );
    const loanFacilityCount = useMemo(
        () => loanGroupsAll.filter(isFacilityOnly).length,
        [loanGroupsAll],
    );

    return (
        <div className="space-y-6 overflow-x-hidden sm:space-y-10">
            <PageHeader
                title="Accounts"
                description="Open obligations as banking products: claims you hold act like savings; amounts you owe act like loans. Grouped by counterparty and currency."
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
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                        "size-11 shrink-0 sm:size-9 transition-shadow",
                                        globalForwardOn
                                            ? "border-emerald-500/60 text-emerald-700 shadow-[0_0_12px_rgba(16,185,129,0.55)] hover:bg-emerald-500/10 dark:text-emerald-400 dark:shadow-[0_0_14px_rgba(52,211,153,0.45)]"
                                            : "border-red-500/70 text-red-700 shadow-[0_0_14px_rgba(239,68,68,0.65)] hover:bg-red-500/10 dark:text-red-400 dark:shadow-[0_0_16px_rgba(248,113,113,0.5)] animate-pulse",
                                    )}
                                    aria-label={
                                        globalForwardOn
                                            ? "Global path-forward offer is on — click to edit"
                                            : "Global path-forward offer is off — click to post one"
                                    }
                                    onClick={() => openRouting(null)}
                                >
                                    <Route className="size-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                {globalForwardOn
                                    ? "Path-forward on — friends can pay through you. Click to edit."
                                    : "Path-forward is off. Friends cannot pay through you until you enable it (route icon). Closed, 0% fee."}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                        "size-11 shrink-0 sm:size-9 transition-shadow",
                                        globalBuyClaimOn
                                            ? "border-emerald-500/60 text-emerald-700 shadow-[0_0_12px_rgba(16,185,129,0.55)] hover:bg-emerald-500/10 dark:text-emerald-400 dark:shadow-[0_0_14px_rgba(52,211,153,0.45)]"
                                            : "border-red-500/70 text-red-700 shadow-[0_0_14px_rgba(239,68,68,0.65)] hover:bg-red-500/10 dark:text-red-400 dark:shadow-[0_0_16px_rgba(248,113,113,0.5)] animate-pulse",
                                    )}
                                    aria-label={
                                        globalBuyClaimOn
                                            ? "Global buy-claim offer is on — click to edit"
                                            : "Global buy-claim offer is off — click to post one"
                                    }
                                    onClick={() => openBuyClaim(null)}
                                >
                                    <Handshake className="size-4" />
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

            <TransferDialog
                open={transferOpen}
                onOpenChange={(open) => {
                    setTransferOpen(open);
                    if (!open && urlTransferPrefill) {
                        setSearchParams({}, { replace: true });
                    }
                }}
                prefill={urlTransferPrefill}
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

            {/* ── Savings / deposits (you are creditor) ───────────────── */}
            <section className="space-y-4">
                <SectionHeader
                    tone="savings"
                    icon={PiggyBank}
                    title="Savings & deposits"
                    description="You are the creditor — balances others owe you, like funds on deposit. Offer a credit line so they can draw."
                    count={savingsGroupsAll.length}
                    countLabel="account"
                    action={
                        <>
                            <HideFacilitiesToggle
                                tone="savings"
                                checked={hideEmptySavings}
                                onCheckedChange={setHideEmptySavings}
                                hiddenCount={savingsFacilityCount}
                            />
                            <Button
                                type="button"
                                size="icon"
                                className="size-11 shrink-0 rounded-full bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 sm:size-9"
                                aria-label="Offer a credit line"
                                onClick={() => {
                                    setEditingLine(null);
                                    setCreditLineOpen(true);
                                }}
                            >
                                <Plus className="size-5" />
                            </Button>
                        </>
                    }
                />

                <ClaimedInviteNicks returnPath="/accounts" />

                <CreditLineDialog
                    open={creditLineOpen}
                    onOpenChange={(open) => {
                        setCreditLineOpen(open);
                        if (!open) setEditingLine(null);
                    }}
                    assets={assets}
                    precisionOf={precisionOf}
                    editing={editingLine}
                />

                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : savingsGroups.length === 0 ? (
                    <EmptyAccounts
                        icon={PiggyBank}
                        tone="savings"
                        title="No deposit balances yet"
                        body="Offer a credit line with +, or wait for someone to deposit with you / draw on a line you extend."
                    />
                ) : (
                    <div className="divide-y overflow-hidden rounded-xl border border-emerald-500/20">
                        {savingsGroups.map((g) => (
                            <AccountGroupRow
                                key={g.key}
                                tone="savings"
                                title={label(g.counterparty)}
                                counterparty={g.counterparty}
                                symbol={symbolOf(g.assetId)}
                                precision={precisionOf(g.assetId)}
                                total={g.total}
                                creditLine={g.creditLine}
                                balanceLabel="Balance"
                            />
                        ))}
                    </div>
                )}
            </section>

            <Separator />

            {/* ── Loans (you are debtor) ──────────────────────────────── */}
            <section className="space-y-4">
                <SectionHeader
                    tone="loan"
                    icon={Building2}
                    title="Loans & liabilities"
                    description="You are the debtor — what you owe, presented like a home loan or line of credit."
                    count={loanGroupsAll.length}
                    countLabel="loan"
                    action={
                        <>
                            <HideFacilitiesToggle
                                tone="loan"
                                checked={hideEmptyLoans}
                                onCheckedChange={setHideEmptyLoans}
                                hiddenCount={loanFacilityCount}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1.5"
                                onClick={() => {
                                    setEditingBookAuth(null);
                                    setBookAuthPrefill(null);
                                    setBookAuthOpen(true);
                                }}
                            >
                                <KeyRound className="size-4" />
                                Allow booking
                            </Button>
                            <Button
                                type="button"
                                size="icon"
                                className="size-11 shrink-0 rounded-full bg-amber-800 text-white hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 sm:size-9"
                                aria-label="Book a deposit"
                                onClick={() => setCreateOpen(true)}
                            >
                                <Plus className="size-5" />
                            </Button>
                        </>
                    }
                />

                <BookAuthDialog
                    open={bookAuthOpen}
                    onOpenChange={(open) => {
                        setBookAuthOpen(open);
                        if (!open) {
                            setEditingBookAuth(null);
                            setBookAuthPrefill(null);
                        }
                    }}
                    assets={assets}
                    precisionOf={precisionOf}
                    prefill={bookAuthPrefill ?? undefined}
                    existing={editingBookAuth}
                />
                <NewDepositLoanDialog
                    open={createOpen}
                    onOpenChange={setCreateOpen}
                    assets={assets}
                    precisionOf={precisionOf}
                />

                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : loanGroups.length === 0 ? (
                    <EmptyAccounts
                        icon={Building2}
                        tone="loan"
                        title="No open loans"
                        body="Draws against credit lines and path payments that leave you owing show up here."
                    />
                ) : (
                    <div className="divide-y overflow-hidden rounded-xl border border-amber-500/25">
                        {loanGroups.map((g) => (
                            <AccountGroupRow
                                key={g.key}
                                tone="loan"
                                title={label(g.counterparty)}
                                counterparty={g.counterparty}
                                symbol={symbolOf(g.assetId)}
                                precision={precisionOf(g.assetId)}
                                total={g.total}
                                creditLine={g.creditLine}
                                balanceLabel="Outstanding"
                            />
                        ))}
                    </div>
                )}
            </section>

            <Separator />

            <section className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-10">
                        <History className="size-4 sm:size-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold tracking-tight sm:text-lg">
                            History
                        </h2>
                        <p className="text-muted-foreground hidden text-sm sm:block">
                            Payments, claim takes, booked expenses, invoices,
                            and line changes. Newest first.
                        </p>
                    </div>
                </div>
                <ActivityFeed />
            </section>
        </div>
    );
}

function HideFacilitiesToggle({
    tone,
    checked,
    onCheckedChange,
    hiddenCount,
}: {
    tone: "savings" | "loan";
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    hiddenCount: number;
}) {
    const id = `hide-facilities-${tone}`;
    return (
        <div className="flex items-center gap-2">
            <Label
                htmlFor={id}
                className="text-muted-foreground hidden text-xs font-normal sm:inline"
            >
                Hide empty
            </Label>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center">
                        <Switch
                            id={id}
                            checked={checked}
                            onCheckedChange={onCheckedChange}
                            aria-label="Hide empty credit facilities"
                        />
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                    {checked
                        ? `Hiding ${hiddenCount} undrawn credit facilit${hiddenCount === 1 ? "y" : "ies"} with zero balance. Turn off to show them.`
                        : "Hide undrawn credit facilities that have no balance yet."}
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

function SectionHeader({
    tone,
    icon: Icon,
    title,
    description,
    count,
    countLabel,
    action,
}: {
    tone: "savings" | "loan";
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    count: number;
    countLabel: string;
    action?: React.ReactNode;
}) {
    const iconCls =
        tone === "savings"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-800 dark:text-amber-400";
    const badgeCls =
        tone === "savings"
            ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
            : "bg-amber-500/10 text-amber-900 dark:text-amber-300";

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-10",
                        iconCls,
                    )}
                >
                    <Icon className="size-4 sm:size-5" />
                </div>
                <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight sm:text-lg">
                        {title}
                    </h2>
                    <p className="text-muted-foreground hidden text-sm sm:block">
                        {description}
                    </p>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                {count > 0 ? (
                    <Badge variant="secondary" className={badgeCls}>
                        {count} {countLabel}
                        {count === 1 ? "" : "s"}
                    </Badge>
                ) : null}
                {action}
            </div>
        </div>
    );
}

function AccountGroupRow({
    tone,
    title,
    counterparty,
    symbol,
    precision,
    total,
    creditLine,
    balanceLabel,
}: {
    tone: "savings" | "loan";
    title: string;
    counterparty: string;
    symbol: string;
    precision: number;
    total: bigint;
    creditLine?: GroupedAccount["creditLine"];
    balanceLabel: string;
}) {
    const amount = formatRawAmount(total.toString(), precision);
    const limitRaw = creditLine
        ? humanToRaw(creditLine.limit || "0", precision)
        : null;
    const exposureRaw = creditLine
        ? humanToRaw(creditLine.exposure || "0", precision)
        : null;
    const remainingRaw = creditLine
        ? humanToRaw(creditLine.remaining || "0", precision)
        : null;
    const availableRaw =
        creditLine &&
        limitRaw !== null &&
        exposureRaw !== null &&
        remainingRaw !== null
            ? lineAvailableRaw(
                  limitRaw,
                  exposureRaw,
                  remainingRaw,
                  creditLine.depleteOnDebit,
              )
            : null;

    const rowBg =
        tone === "savings"
            ? "bg-gradient-to-r from-emerald-500/[0.05] to-transparent"
            : "bg-gradient-to-r from-amber-500/[0.06] to-transparent";
    const amountCls =
        tone === "savings"
            ? "text-emerald-800 dark:text-emerald-300"
            : "text-amber-900 dark:text-amber-300";
    const badgeBorder =
        tone === "savings" ? "border-emerald-500/30" : "border-amber-500/40";

    return (
        <Link
            to={accountHref(counterparty)}
            className={cn(
                "flex items-start gap-3 px-3 py-3 sm:px-4 sm:py-4",
                rowBg,
                "hover:bg-muted/40 transition-colors",
            )}
        >
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold tracking-tight underline-offset-4 hover:underline">
                        {title}
                    </span>
                    {title !== counterparty ? (
                        <span className="text-muted-foreground truncate text-xs">
                            {counterparty}
                        </span>
                    ) : null}
                    <Badge
                        variant="outline"
                        className={cn("font-mono text-xs", badgeBorder)}
                    >
                        {symbol}
                    </Badge>
                    {creditLine && total === 0n ? (
                        <span className="text-muted-foreground text-xs">
                            Credit facility
                        </span>
                    ) : null}
                </div>
                {creditLine &&
                limitRaw !== null &&
                availableRaw !== null ? (
                    <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                        Limit{" "}
                        <span className="text-foreground font-mono tabular-nums">
                            {formatRawAmount(limitRaw.toString(), precision)}
                        </span>
                        <span className="mx-1.5 opacity-40">·</span>
                        Available{" "}
                        <span className="text-foreground font-mono tabular-nums">
                            {formatRawAmount(
                                availableRaw.toString(),
                                precision,
                            )}
                        </span>
                    </p>
                ) : null}
            </div>
            <div className="shrink-0 text-right">
                <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase sm:text-xs">
                    {balanceLabel}
                </p>
                <p
                    className={cn(
                        "font-mono text-lg font-semibold tracking-tight tabular-nums sm:text-2xl",
                        amountCls,
                    )}
                >
                    {amount}
                    <span className="text-muted-foreground ml-1 text-xs font-normal sm:ml-1.5 sm:text-sm">
                        {symbol}
                    </span>
                </p>
            </div>
        </Link>
    );
}

function EmptyAccounts({
    icon: Icon,
    tone,
    title,
    body,
}: {
    icon: React.ComponentType<{ className?: string }>;
    tone: "savings" | "loan";
    title: string;
    body: string;
}) {
    const toneCls =
        tone === "savings"
            ? "border-emerald-500/15 bg-emerald-500/[0.03]"
            : "border-amber-500/15 bg-amber-500/[0.03]";
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center",
                toneCls,
            )}
        >
            <Icon className="text-muted-foreground size-8 opacity-60" />
            <p className="font-medium">{title}</p>
            <p className="text-muted-foreground max-w-md text-sm">{body}</p>
        </div>
    );
}
