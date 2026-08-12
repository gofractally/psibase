import { useEffect, useMemo, useState } from "react";

import {
    Building2,
    ChevronDown,
    HandCoins,
    History,
    Pencil,
    PiggyBank,
    Plus,
} from "lucide-react";

import { AccountHistoryDialog } from "@/components/account-history";
import { AssetSelect } from "@/components/asset-select";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useCreditLines, useObligations } from "@/hooks/use-banx-data";
import {
    useAccrue,
    useDeposit,
    useNet,
    usePathPay,
    useSetCreditLine,
} from "@/hooks/use-banx-mutations";
import { amountPlaceholder, formatRawAmount } from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import type { Asset, CreditLine, Obligation } from "@/lib/graphql";

/** ppm → percent string for form inputs (e.g. 10000 → "1") */
function ppmToPercentInput(ppm: number): string {
    return (ppm / 10_000).toString();
}

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@shared/shadcn/ui/collapsible";
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
import { Separator } from "@shared/shadcn/ui/separator";
import { Switch } from "@shared/shadcn/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/shadcn/ui/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

function totalRaw(principal: string, interest: string): bigint {
    return BigInt(principal || "0") + BigInt(interest || "0");
}

type GroupedAccount = {
    key: string;
    counterparty: string;
    assetId: number;
    obligations: Obligation[];
    /** Principal + interest combined */
    total: bigint;
    /** Matching credit line, if one is extended for this pair/asset */
    creditLine?: CreditLine;
};

function lineKey(creditor: string, debtor: string, assetId: number): string {
    return `${creditor}\0${debtor}\0${assetId}`;
}

function groupByCounterpartyAndAsset(
    items: Obligation[],
    counterpartyOf: (o: Obligation) => string,
): Map<string, GroupedAccount> {
    const map = new Map<string, GroupedAccount>();
    for (const o of items) {
        const counterparty = counterpartyOf(o);
        const key = `${counterparty}\0${o.assetId}`;
        let g = map.get(key);
        if (!g) {
            g = {
                key,
                counterparty,
                assetId: o.assetId,
                obligations: [],
                total: 0n,
            };
            map.set(key, g);
        }
        g.obligations.push(o);
        g.total += totalRaw(o.remainingPrincipal, o.accruedInterest);
    }
    return map;
}

/** Pure undrawn facility: no open obligation balance, just a credit line. */
function isFacilityOnly(g: GroupedAccount): boolean {
    return g.total === 0n && g.obligations.length === 0;
}

function compareByNameThenAsset(a: GroupedAccount, b: GroupedAccount): number {
    const byParty = a.counterparty.localeCompare(b.counterparty);
    if (byParty !== 0) return byParty;
    return a.assetId - b.assetId;
}

/** Balances first (A–Z), then pure credit facilities (A–Z). */
function sortGroups(groups: GroupedAccount[]): GroupedAccount[] {
    return groups.sort((a, b) => {
        const aFac = isFacilityOnly(a);
        const bFac = isFacilityOnly(b);
        if (aFac !== bFac) return aFac ? 1 : -1;
        return compareByNameThenAsset(a, b);
    });
}

function filterGroups(
    groups: GroupedAccount[],
    hideEmptyFacilities: boolean,
): GroupedAccount[] {
    if (!hideEmptyFacilities) return groups;
    return groups.filter((g) => !isFacilityOnly(g));
}

/** Attach lines; also add undrawn facilities so limits show with 0 balance. */
function mergeCreditLines(
    groups: Map<string, GroupedAccount>,
    lines: CreditLine[],
    role: "savings" | "loan",
    user: string,
): GroupedAccount[] {
    const byLine = new Map(
        lines.map((l) => [lineKey(l.creditor, l.debtor, l.assetId), l]),
    );

    for (const g of groups.values()) {
        const key =
            role === "loan"
                ? lineKey(g.counterparty, user, g.assetId)
                : lineKey(user, g.counterparty, g.assetId);
        g.creditLine = byLine.get(key);
    }

    // Undrawn / facility-only rows
    for (const line of lines) {
        const isLoan = line.debtor === user;
        const isSavings = line.creditor === user;
        if (role === "loan" && !isLoan) continue;
        if (role === "savings" && !isSavings) continue;

        const counterparty =
            role === "loan" ? line.creditor : line.debtor;
        const key = `${counterparty}\0${line.assetId}`;
        if (groups.has(key)) continue;

        groups.set(key, {
            key,
            counterparty,
            assetId: line.assetId,
            obligations: [],
            total: 0n,
            creditLine: line,
        });
    }

    return sortGroups([...groups.values()]);
}

export function ObligationsPage() {
    const { data: user } = useCurrentUser();
    const { data: obs = [], isLoading: obsLoading } = useObligations();
    const { data: lines = [], isLoading: linesLoading } = useCreditLines();
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const net = useNet();
    const accrue = useAccrue();
    const isLoading = obsLoading || linesLoading;

    const [counterparty, setCounterparty] = useState("");
    const [assetId, setAssetId] = useState<number | undefined>();
    const [maxAmount, setMaxAmount] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creditLineOpen, setCreditLineOpen] = useState(false);
    /** When set, credit-line dialog edits this facility instead of creating. */
    const [editingLine, setEditingLine] = useState<CreditLine | null>(null);
    const [hideEmptySavings, setHideEmptySavings] = useState(false);
    const [hideEmptyLoans, setHideEmptyLoans] = useState(false);

    const savingsGroupsAll = useMemo(() => {
        if (!user) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.creditor === user),
                (o) => o.debtor,
            ),
            lines,
            "savings",
            user,
        );
    }, [obs, lines, user]);

    const loanGroupsAll = useMemo(() => {
        if (!user) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.debtor === user),
                (o) => o.creditor,
            ),
            lines,
            "loan",
            user,
        );
    }, [obs, lines, user]);

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

    const prefillNet = (party: string, aid: number, maxRaw?: string) => {
        setCounterparty(party);
        setAssetId(aid);
        if (maxRaw !== undefined) {
            setMaxAmount(
                formatRawAmount(maxRaw, precisionOf(aid)).replace(/,/g, ""),
            );
        }
        document
            .getElementById("net-settlement")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const onNet = (e: React.FormEvent) => {
        e.preventDefault();
        if (!assetId || !counterparty.trim() || !maxAmount.trim()) return;
        net.mutate({
            counterparty: counterparty.trim(),
            assetId,
            maxAmount: maxAmount.trim(),
        });
    };

    return (
        <div className="space-y-10">
            <PageHeader
                title="Accounts"
                description="Open obligations as banking products: claims you hold act like savings; amounts you owe act like loans. Grouped by counterparty and currency."
            />

            {/* ── Savings / deposits (you are creditor) ───────────────── */}
            <section className="space-y-4">
                <SectionHeader
                    tone="savings"
                    icon={PiggyBank}
                    title="Savings & deposits"
                    description="You are the creditor — balances others owe you, like funds on deposit. Offer a credit line so they can draw."
                    count={savingsGroups.length}
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
                                className="size-9 shrink-0 rounded-full bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
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
                                title={g.counterparty}
                                counterparty={g.counterparty}
                                assetId={g.assetId}
                                viewer={user ?? ""}
                                symbol={symbolOf(g.assetId)}
                                precision={precisionOf(g.assetId)}
                                total={g.total}
                                obligations={g.obligations}
                                creditLine={g.creditLine}
                                canEditCreditLine={!!g.creditLine}
                                balanceLabel="Balance"
                                accruePending={accrue.isPending}
                                onAccrue={(o) =>
                                    accrue.mutate({
                                        creditor: o.creditor,
                                        debtor: o.debtor,
                                        assetId: o.assetId,
                                    })
                                }
                                onSettle={() =>
                                    prefillNet(
                                        g.counterparty,
                                        g.assetId,
                                        g.total.toString(),
                                    )
                                }
                                onEditCreditLine={
                                    g.creditLine
                                        ? () => {
                                              setEditingLine(g.creditLine!);
                                              setCreditLineOpen(true);
                                          }
                                        : undefined
                                }
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
                    count={loanGroups.length}
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
                                size="icon"
                                className="size-9 shrink-0 rounded-full bg-amber-800 text-white hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500"
                                aria-label="Create deposit or loan"
                                onClick={() => setCreateOpen(true)}
                            >
                                <Plus className="size-5" />
                            </Button>
                        </>
                    }
                />

                <NewAccountDialog
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
                                title={g.counterparty}
                                counterparty={g.counterparty}
                                assetId={g.assetId}
                                viewer={user ?? ""}
                                symbol={symbolOf(g.assetId)}
                                precision={precisionOf(g.assetId)}
                                total={g.total}
                                obligations={g.obligations}
                                creditLine={g.creditLine}
                                canEditCreditLine={false}
                                balanceLabel="Outstanding"
                                accruePending={accrue.isPending}
                                onAccrue={(o) =>
                                    accrue.mutate({
                                        creditor: o.creditor,
                                        debtor: o.debtor,
                                        assetId: o.assetId,
                                    })
                                }
                                onSettle={() =>
                                    prefillNet(
                                        g.counterparty,
                                        g.assetId,
                                        g.total.toString(),
                                    )
                                }
                            />
                        ))}
                    </div>
                )}
            </section>

            <Separator />

            {/* ── Settlement ──────────────────────────────────────────── */}
            <section id="net-settlement" className="scroll-mt-6">
                <form
                    onSubmit={onNet}
                    className="bg-card grid max-w-xl gap-4 rounded-xl border p-5 shadow-sm"
                >
                    <div className="flex items-center gap-3">
                        <div className="bg-muted flex size-10 items-center justify-center rounded-xl">
                            <HandCoins className="text-muted-foreground size-5" />
                        </div>
                        <div>
                            <h2 className="font-semibold tracking-tight">
                                Net settlement
                            </h2>
                            <p className="text-muted-foreground text-sm">
                                Clear mutual claims with a counterparty up to a
                                max amount. No Banx cash balance — deposit + net
                                is how you settle.
                            </p>
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="cp">Counterparty</Label>
                        <Input
                            id="cp"
                            value={counterparty}
                            onChange={(e) => setCounterparty(e.target.value)}
                            placeholder="account name"
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Asset</Label>
                        <AssetSelect
                            assets={assets}
                            value={assetId}
                            onChange={setAssetId}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="max">
                            Max amount{" "}
                            {assetId !== undefined
                                ? `(e.g. ${amountPlaceholder(precisionOf(assetId))})`
                                : ""}
                        </Label>
                        <Input
                            id="max"
                            inputMode="decimal"
                            placeholder={
                                assetId !== undefined
                                    ? amountPlaceholder(precisionOf(assetId))
                                    : "0.00"
                            }
                            value={maxAmount}
                            onChange={(e) => setMaxAmount(e.target.value)}
                            required
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={net.isPending || !assetId}
                        className="w-full sm:w-auto"
                    >
                        {net.isPending ? "Netting…" : "Net pair"}
                    </Button>
                </form>
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
        <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-3">
                <div
                    className={cn(
                        "flex size-10 items-center justify-center rounded-xl",
                        iconCls,
                    )}
                >
                    <Icon className="size-5" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">
                        {title}
                    </h2>
                    <p className="text-muted-foreground text-sm">{description}</p>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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

function CreditLineDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
    editing,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
    /** When set, update this line (debtor + asset fixed). */
    editing: CreditLine | null;
}) {
    const setLine = useSetCreditLine();
    const isEdit = !!editing;

    const [debtor, setDebtor] = useState("");
    const [lineAssetId, setLineAssetId] = useState<number | undefined>();
    const [limit, setLimit] = useState("100");
    const [interestPct, setInterestPct] = useState("0");
    const [deplete, setDeplete] = useState(false);

    useEffect(() => {
        if (!open) return;
        if (editing) {
            setDebtor(editing.debtor);
            setLineAssetId(editing.assetId);
            setLimit(
                formatRawAmount(
                    editing.limit,
                    precisionOf(editing.assetId),
                ).replace(/,/g, ""),
            );
            setInterestPct(ppmToPercentInput(editing.interestRatePpm));
            setDeplete(editing.depleteOnDebit);
        } else {
            setDebtor("");
            setLineAssetId(undefined);
            setLimit("100");
            setInterestPct("0");
            setDeplete(false);
        }
    }, [open, editing, precisionOf]);

    const close = (next: boolean) => {
        onOpenChange(next);
    };

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!lineAssetId || !debtor.trim()) return;
        setLine.mutate(
            {
                debtor: debtor.trim(),
                assetId: lineAssetId,
                limit: limit.trim(),
                depleteOnDebit: deplete,
                interestRatePpm: Math.round(Number(interestPct) * 10_000),
            },
            { onSuccess: () => close(false) },
        );
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? "Edit credit line" : "Offer a credit line"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Update limit, interest, or revolving terms. Debtor and asset stay the same."
                            : "You are the creditor. Set how much the debtor may draw (and hold outstanding) against you. Drawn amounts show up here as savings-style claims."}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="line-debtor">Debtor account</Label>
                        <Input
                            id="line-debtor"
                            value={debtor}
                            onChange={(e) => setDebtor(e.target.value)}
                            placeholder="alice"
                            required
                            disabled={isEdit}
                            readOnly={isEdit}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Asset</Label>
                        {isEdit && lineAssetId !== undefined ? (
                            <Input
                                value={
                                    assets.find((a) => a.id === lineAssetId)
                                        ?.symbol ?? `Asset #${lineAssetId}`
                                }
                                disabled
                                readOnly
                            />
                        ) : (
                            <AssetSelect
                                assets={assets}
                                value={lineAssetId}
                                onChange={setLineAssetId}
                            />
                        )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <div className="grid gap-2">
                            <Label htmlFor="line-limit">
                                Limit
                                {lineAssetId !== undefined
                                    ? ` (${amountPlaceholder(precisionOf(lineAssetId))})`
                                    : ""}
                            </Label>
                            <Input
                                id="line-limit"
                                inputMode="decimal"
                                value={limit}
                                onChange={(e) => setLimit(e.target.value)}
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="line-apr">Interest APR %</Label>
                            <Input
                                id="line-apr"
                                type="number"
                                step="0.01"
                                min={0}
                                value={interestPct}
                                onChange={(e) => setInterestPct(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="line-deplete"
                            checked={deplete}
                            onCheckedChange={(v) => setDeplete(v === true)}
                        />
                        <Label htmlFor="line-deplete" className="font-normal">
                            Deplete limit on each draw (non-revolving)
                        </Label>
                    </div>
                    {isEdit && editing ? (
                        <p className="text-muted-foreground text-xs">
                            Current line exposure:{" "}
                            <span className="text-foreground font-mono tabular-nums">
                                {formatRawAmount(
                                    editing.exposure,
                                    precisionOf(editing.assetId),
                                )}
                            </span>
                            . Limit should stay ≥ exposure for revolving lines.
                        </p>
                    ) : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => close(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={setLine.isPending || !lineAssetId}
                            className="bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                        >
                            {setLine.isPending
                                ? "Saving…"
                                : isEdit
                                  ? "Update credit line"
                                  : "Save credit line"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function NewAccountDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
}) {
    const deposit = useDeposit();
    const pathPay = usePathPay();

    const [tab, setTab] = useState<"deposit" | "loan">("deposit");

    // Deposit (book as receiver → you become debtor / they hold savings)
    const [depositor, setDepositor] = useState("");
    const [depositAssetId, setDepositAssetId] = useState<number | undefined>();
    const [depositAmount, setDepositAmount] = useState("1.00");
    const [depositApr, setDepositApr] = useState("0");

    // Loan draw (single-hop path pay on a credit line)
    const [lender, setLender] = useState("");
    const [loanAssetId, setLoanAssetId] = useState<number | undefined>();
    const [loanAmount, setLoanAmount] = useState("1.00");

    const pending = deposit.isPending || pathPay.isPending;

    const reset = () => {
        setDepositor("");
        setDepositAssetId(undefined);
        setDepositAmount("1.00");
        setDepositApr("0");
        setLender("");
        setLoanAssetId(undefined);
        setLoanAmount("1.00");
        setTab("deposit");
    };

    const close = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    const onDeposit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!depositAssetId || !depositor.trim()) return;
        deposit.mutate(
            {
                depositor: depositor.trim(),
                assetId: depositAssetId,
                amount: depositAmount.trim(),
                interestRatePpm: Math.round(Number(depositApr) * 10_000),
            },
            { onSuccess: () => close(false) },
        );
    };

    const onLoan = (e: React.FormEvent) => {
        e.preventDefault();
        if (!loanAssetId || !lender.trim()) return;
        const amount = loanAmount.trim();
        pathPay.mutate(
            {
                hops: [{ account: lender.trim(), assetId: loanAssetId }],
                amount,
                minReturn: amount,
            },
            { onSuccess: () => close(false) },
        );
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>New deposit or loan</DialogTitle>
                    <DialogDescription>
                        Book a deposit you receive (liability on your books), or
                        draw on a credit line someone offered you.
                    </DialogDescription>
                </DialogHeader>

                <Tabs
                    value={tab}
                    onValueChange={(v) => setTab(v as "deposit" | "loan")}
                >
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="deposit">Deposit</TabsTrigger>
                        <TabsTrigger value="loan">Loan draw</TabsTrigger>
                    </TabsList>

                    <TabsContent value="deposit" className="mt-4">
                        <form onSubmit={onDeposit} className="grid gap-4">
                            <p className="text-muted-foreground text-sm">
                                You accept a deposit: you become the debtor;
                                the depositor holds the claim (their savings).
                                Mutual claims auto-net when possible.
                            </p>
                            <div className="grid gap-2">
                                <Label htmlFor="new-depositor">
                                    Depositor account
                                </Label>
                                <Input
                                    id="new-depositor"
                                    value={depositor}
                                    onChange={(e) =>
                                        setDepositor(e.target.value)
                                    }
                                    placeholder="alice"
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Asset</Label>
                                <AssetSelect
                                    assets={assets}
                                    value={depositAssetId}
                                    onChange={setDepositAssetId}
                                />
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                <div className="grid gap-2">
                                    <Label htmlFor="new-dep-amt">
                                        Amount
                                        {depositAssetId !== undefined
                                            ? ` (${amountPlaceholder(precisionOf(depositAssetId))})`
                                            : ""}
                                    </Label>
                                    <Input
                                        id="new-dep-amt"
                                        inputMode="decimal"
                                        value={depositAmount}
                                        onChange={(e) =>
                                            setDepositAmount(e.target.value)
                                        }
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="new-dep-apr">
                                        Interest APR %
                                    </Label>
                                    <Input
                                        id="new-dep-apr"
                                        type="number"
                                        step="0.01"
                                        min={0}
                                        value={depositApr}
                                        onChange={(e) =>
                                            setDepositApr(e.target.value)
                                        }
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => close(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={pending || !depositAssetId}
                                >
                                    {deposit.isPending
                                        ? "Booking…"
                                        : "Book deposit"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </TabsContent>

                    <TabsContent value="loan" className="mt-4">
                        <form onSubmit={onLoan} className="grid gap-4">
                            <p className="text-muted-foreground text-sm">
                                Draw on a credit line: enter the creditor who
                                offered you the line. Creates a loan under that
                                account and currency.
                            </p>
                            <div className="grid gap-2">
                                <Label htmlFor="new-lender">
                                    Lender (creditor)
                                </Label>
                                <Input
                                    id="new-lender"
                                    value={lender}
                                    onChange={(e) => setLender(e.target.value)}
                                    placeholder="gary"
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Asset</Label>
                                <AssetSelect
                                    assets={assets}
                                    value={loanAssetId}
                                    onChange={setLoanAssetId}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="new-loan-amt">
                                    Draw amount
                                    {loanAssetId !== undefined
                                        ? ` (${amountPlaceholder(precisionOf(loanAssetId))})`
                                        : ""}
                                </Label>
                                <Input
                                    id="new-loan-amt"
                                    inputMode="decimal"
                                    value={loanAmount}
                                    onChange={(e) =>
                                        setLoanAmount(e.target.value)
                                    }
                                    required
                                />
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => close(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={pending || !loanAssetId}
                                >
                                    {pathPay.isPending
                                        ? "Drawing…"
                                        : "Draw loan"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function AccountGroupRow({
    tone,
    title,
    counterparty,
    assetId,
    viewer,
    symbol,
    precision,
    total,
    obligations,
    creditLine,
    canEditCreditLine,
    balanceLabel,
    accruePending,
    onAccrue,
    onSettle,
    onEditCreditLine,
}: {
    tone: "savings" | "loan";
    title: string;
    counterparty: string;
    assetId: number;
    viewer: string;
    symbol: string;
    precision: number;
    total: bigint;
    obligations: Obligation[];
    creditLine?: CreditLine;
    canEditCreditLine?: boolean;
    balanceLabel: string;
    accruePending: boolean;
    onAccrue: (o: Obligation) => void;
    onSettle: () => void;
    onEditCreditLine?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const amount = formatRawAmount(total.toString(), precision);
    const n = obligations.length;
    const hasPositions = n > 0;

    const limitRaw = creditLine ? BigInt(creditLine.limit || "0") : null;
    const exposureRaw = creditLine
        ? BigInt(creditLine.exposure || "0")
        : null;
    const availableRaw =
        limitRaw !== null && exposureRaw !== null
            ? limitRaw > exposureRaw
                ? limitRaw - exposureRaw
                : 0n
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
    const expandBg =
        tone === "savings"
            ? "bg-emerald-500/[0.03] border-emerald-500/10"
            : "bg-amber-500/[0.04] border-amber-500/15";
    const settleTip =
        tone === "savings"
            ? "Settle — net mutual claims with this counterparty"
            : "Repay / net — clear outstanding claims with this lender";
    const editTip =
        "Edit credit line — change limit, interest rate, or revolving terms";
    const historyTip = "History — path draws, deposits, nets, and line changes";

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <div className={cn("w-full", rowBg)}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap sm:gap-4">
                    {hasPositions ? (
                        <CollapsibleTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8 shrink-0"
                                aria-label={
                                    open
                                        ? "Collapse obligation details"
                                        : "Expand obligation details"
                                }
                            >
                                <ChevronDown
                                    className={cn(
                                        "size-4 transition-transform duration-200",
                                        open && "rotate-180",
                                    )}
                                />
                            </Button>
                        </CollapsibleTrigger>
                    ) : (
                        <div className="size-8 shrink-0" aria-hidden />
                    )}

                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold tracking-tight">
                                {title}
                            </p>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "font-mono text-xs",
                                    badgeBorder,
                                )}
                            >
                                {symbol}
                            </Badge>
                            {n > 1 ? (
                                <span className="text-muted-foreground text-xs">
                                    {n} positions
                                </span>
                            ) : null}
                            {creditLine && !hasPositions ? (
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
                                    {formatRawAmount(
                                        limitRaw.toString(),
                                        precision,
                                    )}
                                </span>
                                <span className="mx-1.5 opacity-40">·</span>
                                Available{" "}
                                <span className="text-foreground font-mono tabular-nums">
                                    {formatRawAmount(
                                        availableRaw.toString(),
                                        precision,
                                    )}
                                </span>
                                {creditLine.depleteOnDebit ? (
                                    <span className="ml-1.5 opacity-70">
                                        · non-revolving
                                    </span>
                                ) : null}
                            </p>
                        ) : null}
                    </div>

                    <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0 gap-1 px-2 text-xs"
                                    aria-label={historyTip}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setHistoryOpen(true);
                                    }}
                                >
                                    <History className="size-3.5" />
                                    History
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                {historyTip}
                            </TooltipContent>
                        </Tooltip>
                        {canEditCreditLine && onEditCreditLine ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        className="size-8 shrink-0"
                                        aria-label={editTip}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEditCreditLine();
                                        }}
                                    >
                                        <Pencil className="size-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {editTip}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        {hasPositions ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        className="size-8 shrink-0"
                                        aria-label={settleTip}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSettle();
                                        }}
                                    >
                                        <HandCoins className="size-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {settleTip}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        <div className="min-w-[5.5rem] text-right sm:min-w-[7rem]">
                            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                {balanceLabel}
                            </p>
                            <p
                                className={cn(
                                    "font-mono text-xl font-semibold tracking-tight tabular-nums sm:text-2xl",
                                    amountCls,
                                )}
                            >
                                {amount}
                                <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                                    {symbol}
                                </span>
                            </p>
                        </div>
                    </div>
                </div>

                {hasPositions ? (
                    <CollapsibleContent>
                        <div
                            className={cn(
                                "border-t px-4 py-3 sm:px-14",
                                expandBg,
                            )}
                        >
                            {creditLine &&
                            limitRaw !== null &&
                            exposureRaw !== null &&
                            availableRaw !== null ? (
                                <div className="text-muted-foreground mb-3 grid gap-1 text-xs sm:grid-cols-3 sm:gap-4 sm:text-sm">
                                    <div>
                                        Credit limit{" "}
                                        <span className="text-foreground font-mono tabular-nums">
                                            {formatRawAmount(
                                                limitRaw.toString(),
                                                precision,
                                            )}{" "}
                                            {symbol}
                                        </span>
                                    </div>
                                    <div>
                                        Line exposure{" "}
                                        <span className="text-foreground font-mono tabular-nums">
                                            {formatRawAmount(
                                                exposureRaw.toString(),
                                                precision,
                                            )}{" "}
                                            {symbol}
                                        </span>
                                    </div>
                                    <div>
                                        Available to draw{" "}
                                        <span className="text-foreground font-mono tabular-nums">
                                            {formatRawAmount(
                                                availableRaw.toString(),
                                                precision,
                                            )}{" "}
                                            {symbol}
                                        </span>
                                    </div>
                                </div>
                            ) : null}
                            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                                Individual positions
                            </p>
                            <ul className="divide-border divide-y rounded-lg border bg-background/60">
                                {obligations.map((o) => {
                                    const principal = formatRawAmount(
                                        o.remainingPrincipal,
                                        precision,
                                    );
                                    const interest = formatRawAmount(
                                        o.accruedInterest,
                                        precision,
                                    );
                                    const lineTotal = formatRawAmount(
                                        totalRaw(
                                            o.remainingPrincipal,
                                            o.accruedInterest,
                                        ).toString(),
                                        precision,
                                    );
                                    return (
                                        <li
                                            key={o.id}
                                            className="flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="font-mono text-sm font-medium tabular-nums">
                                                    #{o.id}
                                                    <span className="text-muted-foreground ml-2 font-sans font-normal">
                                                        {lineTotal} {symbol}
                                                    </span>
                                                </p>
                                                <p className="text-muted-foreground mt-0.5 text-xs">
                                                    Principal {principal} ·
                                                    Interest {interest} ·{" "}
                                                    {ppmToPercent(
                                                        o.interestRatePpm,
                                                    )}{" "}
                                                    APR
                                                </p>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={accruePending}
                                                onClick={() => onAccrue(o)}
                                            >
                                                Accrue
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </CollapsibleContent>
                ) : null}
            </div>
            <AccountHistoryDialog
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                counterparty={counterparty}
                assetId={assetId}
                viewer={viewer}
            />
        </Collapsible>
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
