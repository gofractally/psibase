import { useEffect, useMemo, useState } from "react";

import {
    ArrowLeftRight,
    Building2,
    ChevronDown,
    HandCoins,
    History,
    Pencil,
    PiggyBank,
    Handshake,
    Plus,
    Route,
} from "lucide-react";

import { AccountHistoryDialog } from "@/components/account-history";
import { AssetField, GracePeriodField } from "@/components/form-fields";
import { NewDepositLoanDialog } from "@/components/new-deposit-loan-dialog";
import { PageHeader } from "@/components/page-header";
import {
    RoutingPolicyDialog,
    type RoutingPolicyPrefill,
} from "@/components/routing-policy-dialog";
import {
    SellClaimDialog,
    type SellClaimTarget,
} from "@/components/sell-claim-dialog";
import {
    TakeoutOfferDialog,
    type TakeoutOfferPrefill,
} from "@/components/takeout-offer-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCreditLines,
    useForwardOffers,
    useObligations,
    useTakeoutOffers,
} from "@/hooks/use-banx-data";
import { useNet, useSetCreditLine } from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    formatRawAmount,
    humanToRaw,
} from "@/lib/amount";
import {
    DEFAULT_GRACE_SECONDS,
    daysToGraceSeconds,
    formatGracePeriod,
    graceSecondsToPreset,
    ppmToPercent,
    type GracePreset,
} from "@/lib/constants";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { Asset, CreditLine, Obligation } from "@/lib/graphql";

/** ppm → percent string for form inputs (e.g. 10000 → "1") */
function ppmToPercentInput(ppm: number): string {
    return (ppm / 10_000).toString();
}

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
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
import { Label } from "@shared/shadcn/ui/label";
import { Separator } from "@shared/shadcn/ui/separator";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

function totalRaw(
    principal: string,
    interest: string,
    precision: number,
): bigint {
    return (
        humanToRaw(principal || "0", precision) +
        humanToRaw(interest || "0", precision)
    );
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
    precisionOf: (assetId: number) => number,
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
        g.total += totalRaw(
            o.remainingPrincipal,
            o.accruedInterest,
            precisionOf(o.assetId),
        );
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
    const { data: forwardOffers = [] } = useForwardOffers();
    const { data: takeoutOffers = [] } = useTakeoutOffers();
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const net = useNet();
    const isLoading = obsLoading || linesLoading;

    const nowSec = Math.floor(Date.now() / 1000);
    const globalForwardOn = useMemo(
        () =>
            forwardOffers.some(
                (p) => p.isGlobal && (p.expiresAt === 0 || p.expiresAt >= nowSec),
            ),
        [forwardOffers, nowSec],
    );
    const globalTakeoutOn = useMemo(
        () =>
            takeoutOffers.some(
                (p) => p.isGlobal && (p.expiresAt === 0 || p.expiresAt >= nowSec),
            ),
        [takeoutOffers, nowSec],
    );

    const [createOpen, setCreateOpen] = useState(false);
    const [creditLineOpen, setCreditLineOpen] = useState(false);
    /** When set, credit-line dialog edits this facility instead of creating. */
    const [editingLine, setEditingLine] = useState<CreditLine | null>(null);
    const [routingOpen, setRoutingOpen] = useState(false);
    const [routingPrefill, setRoutingPrefill] =
        useState<RoutingPolicyPrefill | null>(null);
    const [sellOpen, setSellOpen] = useState(false);
    const [sellTarget, setSellTarget] = useState<SellClaimTarget | null>(null);
    const [takeoutOpen, setTakeoutOpen] = useState(false);
    const [takeoutPrefill, setTakeoutPrefill] =
        useState<TakeoutOfferPrefill | null>(null);
    const [hideEmptySavings, setHideEmptySavings] = useState(false);
    const [hideEmptyLoans, setHideEmptyLoans] = useState(false);

    const openRouting = (prefill?: RoutingPolicyPrefill | null) => {
        setRoutingPrefill(prefill ?? null);
        setRoutingOpen(true);
    };

    const openTakeout = (prefill?: TakeoutOfferPrefill | null) => {
        setTakeoutPrefill(prefill ?? null);
        setTakeoutOpen(true);
    };

    const netForm = useAppForm({
        defaultValues: {
            counterparty: "",
            assetId: undefined as number | undefined,
            maxAmount: "",
        },
        onSubmit: async ({ value }) => {
            if (
                value.assetId === undefined ||
                !value.counterparty.trim() ||
                !value.maxAmount.trim()
            )
                return;
            await new Promise<void>((resolve, reject) => {
                net.mutate(
                    {
                        counterparty: value.counterparty.trim(),
                        assetId: value.assetId!,
                        maxAmount: value.maxAmount.trim(),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    const savingsGroupsAll = useMemo(() => {
        if (!user) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.creditor === user),
                (o) => o.debtor,
                precisionOf,
            ),
            lines,
            "savings",
            user,
        );
    }, [obs, lines, user, precisionOf]);

    const loanGroupsAll = useMemo(() => {
        if (!user) return [];
        return mergeCreditLines(
            groupByCounterpartyAndAsset(
                obs.filter((o) => o.debtor === user),
                (o) => o.creditor,
                precisionOf,
            ),
            lines,
            "loan",
            user,
        );
    }, [obs, lines, user, precisionOf]);

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
        netForm.setFieldValue("counterparty", party);
        netForm.setFieldValue("assetId", aid);
        if (maxRaw !== undefined) {
            netForm.setFieldValue(
                "maxAmount",
                formatRawAmount(maxRaw, precisionOf(aid)).replace(/,/g, ""),
            );
        }
        document
            .getElementById("net-settlement")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <div className="space-y-10">
            <PageHeader
                title="Accounts"
                description="Open obligations as banking products: claims you hold act like savings; amounts you owe act like loans. Grouped by counterparty and currency."
                action={
                    <div className="flex gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                        "size-9 shrink-0 transition-shadow",
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
                                    ? "Global path-forward on — others can hop through you. Click to edit."
                                    : "No global path-forward — post one so others can hop through you."}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                        "size-9 shrink-0 transition-shadow",
                                        globalTakeoutOn
                                            ? "border-emerald-500/60 text-emerald-700 shadow-[0_0_12px_rgba(16,185,129,0.55)] hover:bg-emerald-500/10 dark:text-emerald-400 dark:shadow-[0_0_14px_rgba(52,211,153,0.45)]"
                                            : "border-red-500/70 text-red-700 shadow-[0_0_14px_rgba(239,68,68,0.65)] hover:bg-red-500/10 dark:text-red-400 dark:shadow-[0_0_16px_rgba(248,113,113,0.5)] animate-pulse",
                                    )}
                                    aria-label={
                                        globalTakeoutOn
                                            ? "Global takeout offer is on — click to edit"
                                            : "Global takeout offer is off — click to post one"
                                    }
                                    onClick={() => openTakeout(null)}
                                >
                                    <Handshake className="size-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                {globalTakeoutOn
                                    ? "Global takeout on — others can sell you claims. Click to edit."
                                    : "No global takeout — post one to buy others' claims."}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                }
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

            <TakeoutOfferDialog
                open={takeoutOpen}
                onOpenChange={(open) => {
                    setTakeoutOpen(open);
                    if (!open) setTakeoutPrefill(null);
                }}
                assets={assets}
                prefill={takeoutPrefill}
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
                                onSetRouting={() =>
                                    openRouting({
                                        creditor: g.counterparty,
                                        assetId: g.assetId,
                                    })
                                }
                                onSetTakeout={() =>
                                    openTakeout({
                                        debtor: g.counterparty,
                                        assetId: g.assetId,
                                    })
                                }
                                onSellClaim={
                                    g.total > 0n
                                        ? () => {
                                              setSellTarget({
                                                  debtor: g.counterparty,
                                                  assetId: g.assetId,
                                                  maxRaw: g.total.toString(),
                                                  symbol: symbolOf(g.assetId),
                                                  precision: precisionOf(
                                                      g.assetId,
                                                  ),
                                              });
                                              setSellOpen(true);
                                          }
                                        : undefined
                                }
                            />
                        ))}
                    </div>
                )}
            </section>

            <SellClaimDialog
                open={sellOpen}
                onOpenChange={(open) => {
                    setSellOpen(open);
                    if (!open) setSellTarget(null);
                }}
                target={sellTarget}
            />

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
                                onSettle={() =>
                                    prefillNet(
                                        g.counterparty,
                                        g.assetId,
                                        g.total.toString(),
                                    )
                                }
                                onSetRouting={() =>
                                    openRouting({
                                        creditor: g.counterparty,
                                        assetId: g.assetId,
                                    })
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
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void netForm.handleSubmit();
                    }}
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
                    <netForm.AppField
                        name="counterparty"
                        children={(field) => (
                            <field.TextField
                                label="Counterparty"
                                placeholder="account name"
                                required
                            />
                        )}
                    />
                    <netForm.Field
                        name="assetId"
                        children={(field) => (
                            <AssetField
                                assets={assets}
                                value={field.state.value}
                                onChange={(id) => field.handleChange(id)}
                            />
                        )}
                    />
                    <netForm.Subscribe
                        selector={(s) => s.values.assetId}
                        children={(assetId) => (
                            <netForm.AppField
                                name="maxAmount"
                                children={(field) => (
                                    <field.TextField
                                        label={
                                            assetId !== undefined
                                                ? `Max amount (e.g. ${amountPlaceholder(precisionOf(assetId))})`
                                                : "Max amount"
                                        }
                                        inputMode="decimal"
                                        placeholder={
                                            assetId !== undefined
                                                ? amountPlaceholder(
                                                      precisionOf(assetId),
                                                  )
                                                : "0.00"
                                        }
                                        required
                                    />
                                )}
                            />
                        )}
                    />
                    <netForm.Subscribe
                        selector={(s) => s.values.assetId}
                        children={(assetId) => (
                            <netForm.AppForm>
                                <netForm.SubmitButton
                                    labels={["Net pair", "Netting…"]}
                                    loading={net.isPending}
                                    disabled={assetId === undefined}
                                />
                            </netForm.AppForm>
                        )}
                    />
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

    const form = useAppForm({
        defaultValues: {
            debtor: "",
            assetId: undefined as number | undefined,
            limit: "100",
            interestPct: "0",
            deplete: false,
            gracePreset: "7" as GracePreset,
            graceDays: "7",
        },
        onSubmit: async ({ value }) => {
            const debtor = isEdit
                ? editing!.debtor
                : value.debtor.trim();
            const assetId = isEdit
                ? editing!.assetId
                : value.assetId;
            if (assetId === undefined || !debtor) return;
            await new Promise<void>((resolve, reject) => {
                setLine.mutate(
                    {
                        debtor,
                        assetId,
                        limit: value.limit.trim(),
                        depleteOnDebit: value.deplete,
                        interestRatePpm: percentStringToPpm(
                            value.interestPct,
                            PPM_SCALE,
                        ),
                        graceSeconds:
                            value.gracePreset === "none"
                                ? 0
                                : daysToGraceSeconds(
                                      value.gracePreset === "custom"
                                          ? Number(value.graceDays.trim())
                                          : Number(value.gracePreset),
                                  ),
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

    useEffect(() => {
        if (!open) return;
        if (editing) {
            const grace = graceSecondsToPreset(
                editing.graceSeconds ?? DEFAULT_GRACE_SECONDS,
            );
            form.reset({
                debtor: editing.debtor,
                assetId: editing.assetId,
                limit: formatRawAmount(
                    editing.limit,
                    precisionOf(editing.assetId),
                ).replace(/,/g, ""),
                interestPct: ppmToPercentInput(editing.interestRatePpm),
                deplete: editing.depleteOnDebit,
                gracePreset: grace.preset,
                graceDays: grace.days,
            });
        } else {
            form.reset({
                debtor: "",
                assetId: undefined,
                limit: "100",
                interestPct: "0",
                deplete: false,
                gracePreset: "7",
                graceDays: "7",
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editing, precisionOf]);

    const editSymbol =
        isEdit && editing
            ? (assets.find((a) => a.id === editing.assetId)?.symbol.toUpperCase() ??
              `#${editing.assetId}`)
            : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit
                            ? `Edit credit line · ${editing!.debtor} · ${editSymbol}`
                            : "Offer a credit line"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? `Update limit, interest, or revolving terms for ${editing!.debtor} in ${editSymbol}.`
                            : "You are the creditor. Set how much the debtor may draw (and hold outstanding) against you. Drawn amounts show up here as savings-style claims."}
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                >
                    {!isEdit ? (
                        <>
                            <form.AppField
                                name="debtor"
                                children={(field) => (
                                    <field.TextField
                                        label="Debtor account"
                                        placeholder="alice"
                                        required
                                    />
                                )}
                            />
                            <form.Field
                                name="assetId"
                                children={(field) => (
                                    <AssetField
                                        assets={assets}
                                        value={field.state.value}
                                        onChange={(id) =>
                                            field.handleChange(id)
                                        }
                                    />
                                )}
                            />
                        </>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <form.Subscribe
                            selector={(s) => s.values.assetId}
                            children={(assetId) => {
                                const aid = isEdit
                                    ? editing!.assetId
                                    : assetId;
                                return (
                                    <form.AppField
                                        name="limit"
                                        children={(field) => (
                                            <field.TextField
                                                label={
                                                    aid !== undefined
                                                        ? `Limit (${amountPlaceholder(precisionOf(aid))})`
                                                        : "Limit"
                                                }
                                                inputMode="decimal"
                                                required
                                            />
                                        )}
                                    />
                                );
                            }}
                        />
                        <form.AppField
                            name="interestPct"
                            validators={{
                                onChange: percentFieldValidator(MAX_PERCENT),
                                onSubmit: percentFieldValidator(MAX_PERCENT),
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Interest APR %"
                                    inputMode="decimal"
                                    min={0}
                                    max={MAX_PERCENT}
                                    step={MIN_PERCENT_STEP}
                                />
                            )}
                        />
                    </div>
                    <form.Subscribe
                        selector={(s) => ({
                            preset: s.values.gracePreset,
                            days: s.values.graceDays,
                        })}
                        children={({ preset, days }) => (
                            <GracePeriodField
                                preset={preset}
                                days={days}
                                onPresetChange={(p) => {
                                    form.setFieldValue("gracePreset", p);
                                    if (p === "none") {
                                        form.setFieldValue("graceDays", "0");
                                    } else if (p !== "custom") {
                                        form.setFieldValue("graceDays", p);
                                    }
                                }}
                                onDaysChange={(d) =>
                                    form.setFieldValue("graceDays", d)
                                }
                            />
                        )}
                    />
                    <p className="text-muted-foreground -mt-2 text-xs">
                        If they repay this pair to zero within this window, no
                        interest. Default is 7 days. Custom is whole days (0 =
                        interest from the first second).{" "}
                        {isEdit && editing && editing.cycleStartedAt
                            ? "An open cycle keeps its snapshotted window; this value applies to the next cycle."
                            : null}
                    </p>
                    <form.AppField
                        name="deplete"
                        children={(field) => (
                            <field.CheckboxField label="Deplete limit on each draw (non-revolving)" />
                        )}
                    />
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
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <form.Subscribe
                            selector={(s) => s.values}
                            children={(values) => {
                                const assetId = isEdit
                                    ? editing!.assetId
                                    : values.assetId;
                                const debtorOk = isEdit
                                    ? true
                                    : !!values.debtor.trim();
                                return (
                                    <form.AppForm>
                                        <form.SubmitButton
                                            labels={
                                                isEdit
                                                    ? [
                                                          "Update credit line",
                                                          "Saving…",
                                                      ]
                                                    : [
                                                          "Save credit line",
                                                          "Saving…",
                                                      ]
                                            }
                                            loading={setLine.isPending}
                                            disabled={
                                                assetId === undefined ||
                                                !debtorOk
                                            }
                                        />
                                    </form.AppForm>
                                );
                            }}
                        />
                    </DialogFooter>
                </form>
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
    onSettle,
    onEditCreditLine,
    onSetRouting,
    onSetTakeout,
    onSellClaim,
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
    onSettle: () => void;
    onEditCreditLine?: () => void;
    /** Path-forward offer with this counterparty as next hop. */
    onSetRouting?: () => void;
    /** Takeout offer to buy claims on this counterparty. */
    onSetTakeout?: () => void;
    /** Sell claim on this counterparty (savings / you are creditor). */
    onSellClaim?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const amount = formatRawAmount(total.toString(), precision);
    const n = obligations.length;
    const hasPositions = n > 0;

    const limitRaw = creditLine
        ? humanToRaw(creditLine.limit || "0", precision)
        : null;
    const exposureRaw = creditLine
        ? humanToRaw(creditLine.exposure || "0", precision)
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
    const routingTip =
        "Path-forward offer — let others hop through you to this party";
    const takeoutTip =
        "Takeout offer — buy others' claims on this party";
    const sellTip =
        "Sell claim — transfer this debt to a buyer under their takeout offer";

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
                        {onSetRouting ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        className="size-8 shrink-0"
                                        aria-label={routingTip}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSetRouting();
                                        }}
                                    >
                                        <Route className="size-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {routingTip}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        {onSetTakeout ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        className="size-8 shrink-0"
                                        aria-label={takeoutTip}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSetTakeout();
                                        }}
                                    >
                                        <Handshake className="size-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {takeoutTip}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        {onSellClaim ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        className="size-8 shrink-0"
                                        aria-label={sellTip}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSellClaim();
                                        }}
                                    >
                                        <ArrowLeftRight className="size-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {sellTip}
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
                                    {creditLine.graceSeconds > 0 ||
                                    creditLine.cycleStartedAt ? (
                                        <div className="sm:col-span-3">
                                            Interest-free{" "}
                                            {formatGracePeriod(
                                                creditLine.cycleStartedAt
                                                    ? creditLine.cycleGraceSeconds
                                                    : creditLine.graceSeconds,
                                            )}
                                            {creditLine.cycleStartedAt
                                                ? " (this cycle)"
                                                : ""}
                                        </div>
                                    ) : null}
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
                                            precision,
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
