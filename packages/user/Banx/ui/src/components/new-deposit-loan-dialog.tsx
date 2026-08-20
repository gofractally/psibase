import { useEffect, useState } from "react";

import { AssetField } from "@/components/form-fields";
import { useDeposit, usePathPay } from "@/hooks/use-banx-mutations";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    existingAccountValidators,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
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
    initialAccount?: string;
    defaultTab?: DepositLoanTab;
}) {
    const deposit = useDeposit();
    const pathPay = usePathPay();
    const [tab, setTab] = useState<DepositLoanTab>(defaultTab);

    const depositForm = useAppForm({
        defaultValues: {
            depositor: "",
            assetId: undefined as number | undefined,
            amount: "1.00",
            aprPct: "0",
        },
        onSubmit: async ({ value }) => {
            if (value.assetId === undefined || !value.depositor.trim()) return;
            await new Promise<void>((resolve, reject) => {
                deposit.mutate(
                    {
                        depositor: value.depositor.trim(),
                        assetId: value.assetId!,
                        amount: value.amount.trim(),
                        interestRatePpm: percentStringToPpm(
                            value.aprPct,
                            PPM_SCALE,
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

    const loanForm = useAppForm({
        defaultValues: {
            lender: "",
            assetId: undefined as number | undefined,
            amount: "1.00",
        },
        onSubmit: async ({ value }) => {
            if (value.assetId === undefined || !value.lender.trim()) return;
            const amount = value.amount.trim();
            await new Promise<void>((resolve, reject) => {
                pathPay.mutate(
                    {
                        hops: [
                            {
                                account: value.lender.trim(),
                                assetId: value.assetId!,
                            },
                        ],
                        amount,
                        minReturn: amount,
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
        const account = initialAccount?.trim() ?? "";
        setTab(defaultTab);
        depositForm.reset({
            depositor: account,
            assetId: undefined,
            amount: "1.00",
            aprPct: "0",
        });
        loanForm.reset({
            lender: account,
            assetId: undefined,
            amount: "1.00",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialAccount, defaultTab]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
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
                        <form
                            className="grid gap-4"
                            onSubmit={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void depositForm.handleSubmit();
                            }}
                        >
                            <p className="text-muted-foreground text-sm">
                                You accept a deposit: you become the debtor; the
                                depositor holds the claim (their savings).
                                Mutual claims auto-net when possible.
                            </p>
                            <depositForm.AppField
                                name="depositor"
                                validators={existingAccountValidators()}
                                children={(field) => (
                                    <field.TextField
                                        label="Depositor account"
                                        placeholder="alice"
                                        required
                                    />
                                )}
                            />
                            <depositForm.Field
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
                            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                <depositForm.Subscribe
                                    selector={(s) => s.values.assetId}
                                    children={(assetId) => (
                                        <depositForm.AppField
                                            name="amount"
                                            validators={
                                                assetId !== undefined
                                                    ? {
                                                          onChange:
                                                              amountFieldValidator(
                                                                  precisionOf(
                                                                      assetId,
                                                                  ),
                                                                  {
                                                                      allowZero: false,
                                                                  },
                                                              ),
                                                          onSubmit:
                                                              amountFieldValidator(
                                                                  precisionOf(
                                                                      assetId,
                                                                  ),
                                                                  {
                                                                      allowZero: false,
                                                                  },
                                                              ),
                                                      }
                                                    : undefined
                                            }
                                            children={(field) => (
                                                <field.TextField
                                                    label="Amount"
                                                    inputMode="decimal"
                                                    required
                                                />
                                            )}
                                        />
                                    )}
                                />
                                <depositForm.AppField
                                    name="aprPct"
                                    validators={{
                                        onChange:
                                            percentFieldValidator(MAX_PERCENT),
                                        onSubmit:
                                            percentFieldValidator(MAX_PERCENT),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Interest APR %"
                                            inputMode="decimal"
                                            min={0}
                                            max={MAX_PERCENT}
                                            step={MIN_PERCENT_STEP}
                                            description="0–100% (0.0001% = 1 ppm)"
                                        />
                                    )}
                                />
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <depositForm.Subscribe
                                    selector={(s) => s.values.assetId}
                                    children={(assetId) => (
                                        <depositForm.AppForm>
                                            <depositForm.SubmitButton
                                                labels={[
                                                    "Book deposit",
                                                    "Booking…",
                                                ]}
                                                loading={deposit.isPending}
                                                disabled={
                                                    assetId === undefined
                                                }
                                            />
                                        </depositForm.AppForm>
                                    )}
                                />
                            </DialogFooter>
                        </form>
                    </TabsContent>

                    <TabsContent value="loan" className="mt-4">
                        <form
                            className="grid gap-4"
                            onSubmit={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void loanForm.handleSubmit();
                            }}
                        >
                            <p className="text-muted-foreground text-sm">
                                Draw on a credit line: enter the creditor who
                                offered you the line. Creates a loan under that
                                account and currency.
                            </p>
                            <loanForm.AppField
                                name="lender"
                                validators={existingAccountValidators()}
                                children={(field) => (
                                    <field.TextField
                                        label="Lender (creditor)"
                                        placeholder="gary"
                                        required
                                    />
                                )}
                            />
                            <loanForm.Field
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
                            <loanForm.Subscribe
                                selector={(s) => s.values.assetId}
                                children={(assetId) => (
                                    <loanForm.AppField
                                        name="amount"
                                        validators={
                                            assetId !== undefined
                                                ? {
                                                      onChange:
                                                          amountFieldValidator(
                                                              precisionOf(
                                                                  assetId,
                                                              ),
                                                              {
                                                                  allowZero: false,
                                                              },
                                                          ),
                                                      onSubmit:
                                                          amountFieldValidator(
                                                              precisionOf(
                                                                  assetId,
                                                              ),
                                                              {
                                                                  allowZero: false,
                                                              },
                                                          ),
                                                  }
                                                : undefined
                                        }
                                        children={(field) => (
                                            <field.TextField
                                                label="Draw amount"
                                                inputMode="decimal"
                                                required
                                            />
                                        )}
                                    />
                                )}
                            />
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <loanForm.Subscribe
                                    selector={(s) => s.values.assetId}
                                    children={(assetId) => (
                                        <loanForm.AppForm>
                                            <loanForm.SubmitButton
                                                labels={[
                                                    "Draw loan",
                                                    "Drawing…",
                                                ]}
                                                loading={pathPay.isPending}
                                                disabled={
                                                    assetId === undefined
                                                }
                                            />
                                        </loanForm.AppForm>
                                    )}
                                />
                            </DialogFooter>
                        </form>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
