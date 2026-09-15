import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
    ArrowLeft,
    ArrowLeftRight,
    CircleMinus,
    GitBranch,
    HandCoins,
    Handshake,
    History,
    Inbox,
    KeyRound,
    Pencil,
    PiggyBank,
    Plus,
    Receipt,
    Route,
    ShoppingCart,
    Store,
} from "lucide-react";

import { AccountHistoryDialog } from "@/components/account-history";
import { AccountRowAction } from "@/components/account-row-action";
import { BookAuthDialog } from "@/components/book-auth-dialog";
import { BookExpenseDialog } from "@/components/book-expense-dialog";
import { CreditLineDialog } from "@/components/credit-line-dialog";
import {
    ForgiveDialog,
    type ForgiveTarget,
} from "@/components/forgive-dialog";
import { PageHeader } from "@/components/page-header";
import {
    RequestDialog,
    type RequestPrefill,
} from "@/components/request-dialog";
import {
    RoutingPolicyDialog,
    type RoutingPolicyPrefill,
} from "@/components/routing-policy-dialog";
import {
    BuyClaimOfferDialog,
    type BuyClaimPrefill,
} from "@/components/buy-claim-offer-dialog";
import {
    SellClaimDialog,
    type SellClaimTarget,
} from "@/components/sell-claim-dialog";
import { NewDepositLoanDialog } from "@/components/new-deposit-loan-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import { useAccountGroups } from "@/hooks/use-account-groups";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import { useBookAuths } from "@/hooks/use-banx-data";
import {
    liveBookAuth,
    spendableBookAuth,
    totalRaw,
    type GroupedAccount,
} from "@/lib/account-groups";
import { formatRawAmount, humanToRaw, lineAvailableRaw } from "@/lib/amount";
import { formatGracePeriod, ppmToPercent } from "@/lib/constants";
import {
    REQUEST_INVOICE,
    REQUEST_PLEASE_BOOK,
    type BookAuth,
    type CreditLine,
} from "@/lib/graphql";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";

export function AccountDetailPage() {
    const params = useParams();
    const account = decodeURIComponent(params.account ?? "").trim();
    const { user, savings, loans, isLoading } = useAccountGroups();
    const { label, nicknameOf } = useBanxContacts("/accounts");
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const { data: bookAuths = [] } = useBookAuths();

    const savingsHere = useMemo(
        () => savings.filter((g) => g.counterparty === account),
        [savings, account],
    );
    const loansHere = useMemo(
        () => loans.filter((g) => g.counterparty === account),
        [loans, account],
    );

    const [transferOpen, setTransferOpen] = useState(false);
    const [depositOpen, setDepositOpen] = useState(false);
    const [creditLineOpen, setCreditLineOpen] = useState(false);
    const [editingLine, setEditingLine] = useState<CreditLine | null>(null);
    const [routingOpen, setRoutingOpen] = useState(false);
    const [routingPrefill, setRoutingPrefill] =
        useState<RoutingPolicyPrefill | null>(null);
    const [buyClaimOpen, setBuyClaimOpen] = useState(false);
    const [buyClaimPrefill, setBuyClaimPrefill] =
        useState<BuyClaimPrefill | null>(null);
    const [requestOpen, setRequestOpen] = useState(false);
    const [requestPrefill, setRequestPrefill] =
        useState<RequestPrefill | null>(null);
    const [sellOpen, setSellOpen] = useState(false);
    const [sellTarget, setSellTarget] = useState<SellClaimTarget | null>(null);
    const [sellTradeMode, setSellTradeMode] = useState<"sell" | "buy">("sell");
    const [forgiveOpen, setForgiveOpen] = useState(false);
    const [forgiveTarget, setForgiveTarget] = useState<ForgiveTarget | null>(
        null,
    );
    const [bookAuthOpen, setBookAuthOpen] = useState(false);
    const [bookAuthPrefill, setBookAuthPrefill] = useState<{
        creditor?: string;
        assetId?: number;
    } | null>(null);
    const [editingBookAuth, setEditingBookAuth] = useState<BookAuth | null>(
        null,
    );
    const [bookExpenseAuth, setBookExpenseAuth] = useState<BookAuth | null>(
        null,
    );
    const [history, setHistory] = useState<{
        assetId: number;
    } | null>(null);

    const nick = nicknameOf(account);
    const display = label(account);
    const hasAnything = savingsHere.length > 0 || loansHere.length > 0;

    if (!account) {
        return (
            <p className="text-muted-foreground text-sm">Missing account.</p>
        );
    }

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" asChild>
                    <Link to="/accounts">
                        <ArrowLeft className="size-4" />
                        Accounts
                    </Link>
                </Button>
                <PageHeader
                    title={display}
                    description={
                        nick && nick !== account ? account : undefined
                    }
                    action={
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                className="gap-1.5"
                                onClick={() => setTransferOpen(true)}
                            >
                                <GitBranch className="size-4" />
                                Transfer
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => setDepositOpen(true)}
                            >
                                <HandCoins className="size-4" />
                                Deposit
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => {
                                    setEditingLine(null);
                                    setCreditLineOpen(true);
                                }}
                            >
                                <Plus className="size-4" />
                                Credit line
                            </Button>
                        </div>
                    }
                />
                <div className="flex items-center gap-3">
                    <Avatar account={account} className="size-12" />
                    <div className="min-w-0">
                        <p className="font-semibold tracking-tight">{display}</p>
                        {display !== account ? (
                            <p className="text-muted-foreground font-mono text-sm">
                                {account}
                            </p>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                Counterparty
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <TransferDialog
                open={transferOpen}
                onOpenChange={setTransferOpen}
                prefill={{ payee: account }}
            />
            <NewDepositLoanDialog
                open={depositOpen}
                onOpenChange={setDepositOpen}
                assets={assets}
                precisionOf={precisionOf}
                initialAccount={account}
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
                prefillDebtor={account}
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
            <RequestDialog
                open={requestOpen}
                onOpenChange={(open) => {
                    setRequestOpen(open);
                    if (!open) setRequestPrefill(null);
                }}
                assets={assets}
                precisionOf={precisionOf}
                prefill={requestPrefill}
            />
            <SellClaimDialog
                open={sellOpen}
                onOpenChange={(open) => {
                    setSellOpen(open);
                    if (!open) setSellTarget(null);
                }}
                target={sellTarget}
                mode={sellTradeMode}
            />
            <ForgiveDialog
                open={forgiveOpen}
                onOpenChange={(open) => {
                    setForgiveOpen(open);
                    if (!open) setForgiveTarget(null);
                }}
                target={forgiveTarget}
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
            <BookExpenseDialog
                open={!!bookExpenseAuth}
                onOpenChange={(open) => {
                    if (!open) setBookExpenseAuth(null);
                }}
                auth={bookExpenseAuth}
                symbol={
                    bookExpenseAuth ? symbolOf(bookExpenseAuth.assetId) : ""
                }
                precision={
                    bookExpenseAuth
                        ? precisionOf(bookExpenseAuth.assetId)
                        : 0
                }
            />
            <AccountHistoryDialog
                open={!!history}
                onOpenChange={(open) => {
                    if (!open) setHistory(null);
                }}
                counterparty={account}
                assetId={history?.assetId ?? 0}
                viewer={user ?? ""}
            />

            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : !hasAnything ? (
                <p className="text-muted-foreground text-sm">
                    No lines or balances with {display} yet. Offer a credit
                    line to put them on your book.
                </p>
            ) : (
                <div className="space-y-8">
                    {savingsHere.length > 0 ? (
                        <section className="space-y-3">
                            <h2 className="flex items-center gap-2 text-sm font-medium">
                                <PiggyBank className="size-4" />
                                You hold (savings)
                            </h2>
                            {savingsHere.map((g) => (
                                <AssetRelationCard
                                    key={g.key}
                                    tone="savings"
                                    group={g}
                                    symbol={symbolOf(g.assetId)}
                                    precision={precisionOf(g.assetId)}
                                    onHistory={() =>
                                        setHistory({ assetId: g.assetId })
                                    }
                                    onEditLine={
                                        g.creditLine
                                            ? () => {
                                                  setEditingLine(g.creditLine!);
                                                  setCreditLineOpen(true);
                                              }
                                            : undefined
                                    }
                                    onRouting={() => {
                                        setRoutingPrefill({
                                            creditor: account,
                                            assetId: g.assetId,
                                        });
                                        setRoutingOpen(true);
                                    }}
                                    onBuyClaim={() => {
                                        setBuyClaimPrefill({
                                            debtor: account,
                                            assetId: g.assetId,
                                        });
                                        setBuyClaimOpen(true);
                                    }}
                                    onRequest={() => {
                                        setRequestPrefill({
                                            kind: REQUEST_INVOICE,
                                            counterparty: account,
                                            assetId: g.assetId,
                                            amount:
                                                g.total > 0n
                                                    ? formatRawAmount(
                                                          g.total.toString(),
                                                          precisionOf(
                                                              g.assetId,
                                                          ),
                                                      )
                                                    : undefined,
                                        });
                                        setRequestOpen(true);
                                    }}
                                    onPostSell={() => {
                                        setBuyClaimPrefill({
                                            debtor: account,
                                            assetId: g.assetId,
                                            side: "sell",
                                        });
                                        setBuyClaimOpen(true);
                                    }}
                                    onSell={
                                        g.total > 0n
                                            ? () => {
                                                  setSellTradeMode("sell");
                                                  setSellTarget({
                                                      debtor: account,
                                                      assetId: g.assetId,
                                                      maxRaw: g.total.toString(),
                                                      symbol: symbolOf(
                                                          g.assetId,
                                                      ),
                                                      precision: precisionOf(
                                                          g.assetId,
                                                      ),
                                                  });
                                                  setSellOpen(true);
                                              }
                                            : undefined
                                    }
                                    onForgive={
                                        g.total > 0n
                                            ? () => {
                                                  setForgiveTarget({
                                                      debtor: account,
                                                      assetId: g.assetId,
                                                      maxRaw: g.total.toString(),
                                                      symbol: symbolOf(
                                                          g.assetId,
                                                      ),
                                                      precision: precisionOf(
                                                          g.assetId,
                                                      ),
                                                  });
                                                  setForgiveOpen(true);
                                              }
                                            : undefined
                                    }
                                    onBuyPosted={() => {
                                        setSellTradeMode("buy");
                                        setSellTarget({
                                            debtor: account,
                                            assetId: g.assetId,
                                            maxRaw: "0",
                                            symbol: symbolOf(g.assetId),
                                            precision: precisionOf(g.assetId),
                                        });
                                        setSellOpen(true);
                                    }}
                                    onBookExpense={
                                        user
                                            ? (() => {
                                                  const auth =
                                                      spendableBookAuth(
                                                          bookAuths,
                                                          account,
                                                          user,
                                                          g.assetId,
                                                      );
                                                  return auth
                                                      ? () =>
                                                            setBookExpenseAuth(
                                                                auth,
                                                            )
                                                      : undefined;
                                              })()
                                            : undefined
                                    }
                                />
                            ))}
                        </section>
                    ) : null}

                    {loansHere.length > 0 ? (
                        <section className="space-y-3">
                            <h2 className="flex items-center gap-2 text-sm font-medium">
                                You owe (loans)
                            </h2>
                            {loansHere.map((g) => (
                                <AssetRelationCard
                                    key={g.key}
                                    tone="loan"
                                    group={g}
                                    symbol={symbolOf(g.assetId)}
                                    precision={precisionOf(g.assetId)}
                                    onHistory={() =>
                                        setHistory({ assetId: g.assetId })
                                    }
                                    onRouting={() => {
                                        setRoutingPrefill({
                                            creditor: account,
                                            assetId: g.assetId,
                                        });
                                        setRoutingOpen(true);
                                    }}
                                    onRequest={() => {
                                        setRequestPrefill({
                                            kind: REQUEST_PLEASE_BOOK,
                                            counterparty: account,
                                            assetId: g.assetId,
                                            amount:
                                                g.total > 0n
                                                    ? formatRawAmount(
                                                          g.total.toString(),
                                                          precisionOf(
                                                              g.assetId,
                                                          ),
                                                      )
                                                    : undefined,
                                        });
                                        setRequestOpen(true);
                                    }}
                                    onEditBookAuth={() => {
                                        const existing = user
                                            ? liveBookAuth(
                                                  bookAuths,
                                                  user,
                                                  account,
                                                  g.assetId,
                                              )
                                            : undefined;
                                        setEditingBookAuth(existing ?? null);
                                        setBookAuthPrefill({
                                            creditor: account,
                                            assetId: g.assetId,
                                        });
                                        setBookAuthOpen(true);
                                    }}
                                />
                            ))}
                        </section>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function AssetRelationCard({
    tone,
    group: g,
    symbol,
    precision,
    onHistory,
    onEditLine,
    onRouting,
    onBuyClaim,
    onRequest,
    onPostSell,
    onSell,
    onForgive,
    onBuyPosted,
    onBookExpense,
    onEditBookAuth,
}: {
    tone: "savings" | "loan";
    group: GroupedAccount;
    symbol: string;
    precision: number;
    onHistory: () => void;
    onEditLine?: () => void;
    onRouting?: () => void;
    onBuyClaim?: () => void;
    onRequest?: () => void;
    onPostSell?: () => void;
    onSell?: () => void;
    onForgive?: () => void;
    onBuyPosted?: () => void;
    onBookExpense?: () => void;
    onEditBookAuth?: () => void;
}) {
    const amount = formatRawAmount(g.total.toString(), precision);
    const creditLine = g.creditLine;
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

    const border =
        tone === "savings" ? "border-emerald-500/20" : "border-amber-500/25";
    const amountCls =
        tone === "savings"
            ? "text-emerald-800 dark:text-emerald-300"
            : "text-amber-900 dark:text-amber-300";

    return (
        <div className={cn("rounded-xl border p-4", border)}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                            {symbol}
                        </Badge>
                        {creditLine && g.total === 0n ? (
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
                            {creditLine.graceSeconds > 0 ||
                            creditLine.cycleStartedAt ? (
                                <>
                                    <span className="mx-1.5 opacity-40">
                                        ·
                                    </span>
                                    Interest-free{" "}
                                    {formatGracePeriod(
                                        creditLine.cycleStartedAt
                                            ? creditLine.cycleGraceSeconds
                                            : creditLine.graceSeconds,
                                    )}
                                    {creditLine.cycleStartedAt
                                        ? " (this cycle)"
                                        : ""}
                                </>
                            ) : null}
                        </p>
                    ) : null}
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                        {tone === "savings" ? "Balance" : "Outstanding"}
                    </p>
                    <p
                        className={cn(
                            "font-mono text-lg font-semibold tabular-nums sm:text-xl",
                            amountCls,
                        )}
                    >
                        {amount}
                        <span className="text-muted-foreground ml-1 text-xs font-normal">
                            {symbol}
                        </span>
                    </p>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <AccountRowAction
                    tip="History"
                    icon={History}
                    label="History"
                    onClick={onHistory}
                />
                {onEditLine ? (
                    <AccountRowAction
                        tip="Edit credit line"
                        icon={Pencil}
                        label="Edit line"
                        onClick={onEditLine}
                    />
                ) : null}
                {onRouting ? (
                    <AccountRowAction
                        tip="Path-forward offer — let others hop through you to this party"
                        icon={Route}
                        onClick={onRouting}
                    />
                ) : null}
                {onBuyClaim ? (
                    <AccountRowAction
                        tip="Buy-claim offer — buy others' claims on this party"
                        icon={Handshake}
                        onClick={onBuyClaim}
                    />
                ) : null}
                {onBookExpense ? (
                    <AccountRowAction
                        tip="Book expense"
                        icon={Receipt}
                        label="Book"
                        onClick={onBookExpense}
                    />
                ) : null}
                {onEditBookAuth ? (
                    <AccountRowAction
                        tip="Allow booking — let them record expenses onto you"
                        icon={KeyRound}
                        label="Booking"
                        onClick={onEditBookAuth}
                    />
                ) : null}
                {onRequest ? (
                    <AccountRowAction
                        tip="Request — invoice or deposit request"
                        icon={Inbox}
                        label="Request"
                        onClick={onRequest}
                    />
                ) : null}
                {onPostSell ? (
                    <AccountRowAction
                        tip="Sell-claim offer — post an ask so others can buy this claim"
                        icon={Store}
                        onClick={onPostSell}
                    />
                ) : null}
                {onSell ? (
                    <AccountRowAction
                        tip="Sell claim"
                        icon={ArrowLeftRight}
                        onClick={onSell}
                    />
                ) : null}
                {onForgive ? (
                    <AccountRowAction
                        tip="Write off"
                        icon={CircleMinus}
                        onClick={onForgive}
                    />
                ) : null}
                {onBuyPosted ? (
                    <AccountRowAction
                        tip="Buy posted claim"
                        icon={ShoppingCart}
                        onClick={onBuyPosted}
                    />
                ) : null}
            </div>

            {g.obligations.length > 0 ? (
                <ul className="divide-border mt-3 divide-y rounded-lg border">
                    {g.obligations.map((o) => {
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
                            <li key={o.id} className="px-3 py-2">
                                <p className="font-mono text-sm font-medium tabular-nums">
                                    #{o.id}
                                    <span className="text-muted-foreground ml-2 font-sans font-normal">
                                        {lineTotal} {symbol}
                                    </span>
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    Principal {principal} · Interest {interest}{" "}
                                    · {ppmToPercent(o.interestRatePpm)} APR
                                </p>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
