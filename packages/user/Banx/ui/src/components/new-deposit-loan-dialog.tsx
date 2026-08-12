import { useEffect, useState } from "react";

import { AssetSelect } from "@/components/asset-select";
import { useDeposit, usePathPay } from "@/hooks/use-banx-mutations";
import { amountPlaceholder } from "@/lib/amount";
import type { Asset } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/shadcn/ui/tabs";

export type DepositLoanTab = "deposit" | "loan";

/**
 * Book a deposit (you receive funds as debtor) or draw a single-hop loan on a
 * credit line. Optional `initialAccount` pre-fills depositor / lender (e.g. from Payees).
 */
export function NewDepositLoanDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
    initialAccount,
    defaultTab = "deposit",
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
    /** Prefill depositor (deposit tab) and lender (loan tab). */
    initialAccount?: string;
    defaultTab?: DepositLoanTab;
}) {
    const deposit = useDeposit();
    const pathPay = usePathPay();

    const [tab, setTab] = useState<DepositLoanTab>(defaultTab);

    const [depositor, setDepositor] = useState("");
    const [depositAssetId, setDepositAssetId] = useState<number | undefined>();
    const [depositAmount, setDepositAmount] = useState("1.00");
    const [depositApr, setDepositApr] = useState("0");

    const [lender, setLender] = useState("");
    const [loanAssetId, setLoanAssetId] = useState<number | undefined>();
    const [loanAmount, setLoanAmount] = useState("1.00");

    const pending = deposit.isPending || pathPay.isPending;

    // When the dialog opens, seed counterparty fields from the payee (if any).
    useEffect(() => {
        if (!open) return;
        const account = initialAccount?.trim() ?? "";
        setTab(defaultTab);
        setDepositor(account);
        setLender(account);
        setDepositAssetId(undefined);
        setDepositAmount("1.00");
        setDepositApr("0");
        setLoanAssetId(undefined);
        setLoanAmount("1.00");
    }, [open, initialAccount, defaultTab]);

    const close = (next: boolean) => {
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
                        {initialAccount ? (
                            <>
                                {" "}
                                Payee: <strong>{initialAccount}</strong>
                            </>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                <Tabs
                    value={tab}
                    onValueChange={(v) => setTab(v as DepositLoanTab)}
                >
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="deposit">Deposit</TabsTrigger>
                        <TabsTrigger value="loan">Loan draw</TabsTrigger>
                    </TabsList>

                    <TabsContent value="deposit" className="mt-4">
                        <form onSubmit={onDeposit} className="grid gap-4">
                            <p className="text-muted-foreground text-sm">
                                You accept a deposit: you become the debtor; the
                                depositor holds the claim (their savings). Mutual
                                claims auto-net when possible.
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
