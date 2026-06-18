import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import { useStore } from "@tanstack/react-form";
import { useCallback, useMemo, useRef, useState } from "react";
import z from "zod";

import { useBuyName } from "@/apps/prem-accounts/hooks/use-buy-name";
import { ACCOUNT_MARKETPLACE_PATH } from "@/apps/prem-accounts/route";

import { useAppForm } from "@shared/components/form/app-form";
import { AvailableBalanceLabel } from "@shared/components/premium-accounts/available-balance-label";
import { BuyNameConfirmationDialog } from "@shared/components/premium-accounts/buy-name-confirmation-dialog";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useUserTokenBalances, getSystemTokenBalance } from "@shared/hooks/use-user-token-balances";
import { getAccount } from "@shared/lib/get-account";
import { Quantity } from "@shared/lib/quantity";
import { zAccount } from "@shared/lib/schemas/account";
import { CardContent, CardFooter } from "@shared/shadcn/ui/card";
import { Spinner } from "@shared/shadcn/ui/spinner";

function maxCostFromPrice(price: Quantity): string {
    return price.format({
        includeLabel: false,
        fullPrecision: true,
        showThousandsSeparator: false,
    });
}

export function BuyForm({
    systemToken,
    prices,
}: {
    systemToken: SystemTokenInfo;
    prices: Map<number, string>;
}) {
    const { data: currentUser } = useCurrentUser();
    const { data: tokenBalances, isPending: isPendingBalances } =
        useUserTokenBalances(currentUser);

    const availableBalance = useMemo(
        () => getSystemTokenBalance(tokenBalances, systemToken.id),
        [tokenBalances, systemToken.id],
    );

    const [confirmPrice, setConfirmPrice] = useState<Quantity | null>(null);
    const [isAccountTaken, setIsAccountTaken] = useState<boolean | null>(null);
    const [buyConfirmOpen, setBuyConfirmOpen] = useState(false);
    const [purchaseComplete, setPurchaseComplete] = useState(false);
    const [purchasedAccountName, setPurchasedAccountName] = useState<
        string | null
    >(null);

    const pricesRef = useRef(prices);
    pricesRef.current = prices;
    const isAccountTakenRef = useRef(isAccountTaken);
    isAccountTakenRef.current = isAccountTaken;

    const resolveLivePrice = useCallback(
        (rawAccountName: string): Quantity | null => {
            const parsed = zAccount.safeParse(rawAccountName.trim());
            if (!parsed.success || isAccountTakenRef.current !== false) {
                return null;
            }
            const canonical = pricesRef.current.get(parsed.data.length);
            if (!canonical) {
                return null;
            }
            return new Quantity(
                canonical,
                systemToken.precision,
                Number(systemToken.id),
                systemToken.symbol,
            );
        },
        [systemToken],
    );

    const { mutateAsync: buyName, isPending: isBuying } = useBuyName();

    const form = useAppForm({
        defaultValues: {
            accountName: "",
        },
        onSubmit: async ({ value }) => {
            const priceAtSubmit = resolveLivePrice(value.accountName);
            if (!priceAtSubmit) {
                const message =
                    "Market price is not available. Check the account name and try again.";
                form.setFieldMeta("accountName", (prev) => ({
                    ...prev,
                    isTouched: true,
                    errors: [message],
                    errorMap: { onSubmit: message },
                }));
                return;
            }

            setConfirmPrice(priceAtSubmit);
            setBuyConfirmOpen(true);
        },
        validators: {
            onChange: z.object({
                accountName: zAccount.or(z.literal("")),
            }),
            onSubmitAsync: async ({ value }) => {
                let taken = false;

                try {
                    const account = await getAccount(value.accountName);
                    taken = Boolean(account?.accountNum);
                    setIsAccountTaken(taken);
                    isAccountTakenRef.current = taken;
                } catch (error) {
                    console.error("Error validating on submit:", error);
                    return {
                        fields: {
                            accountName:
                                "There was a problem submitting your request. Please try again.",
                        },
                    };
                }

                const priceAtSubmit = taken
                    ? null
                    : resolveLivePrice(value.accountName);

                return {
                    fields: {
                        accountName: taken
                            ? "This account name is not available"
                            : !priceAtSubmit
                              ? "Market price is not available for this name."
                              : undefined,
                    },
                };
            },
        },
    });

    const accountName = useStore(
        form.store,
        (state) => state.values.accountName,
    );

    const livePrice = useMemo(
        () => resolveLivePrice(accountName),
        // Re-run when polled prices or availability change (resolveLivePrice reads refs).
        // eslint-disable-next-line react-hooks/exhaustive-deps -- prices, isAccountTaken
        [accountName, prices, isAccountTaken, resolveLivePrice],
    );

    const hasInsufficientFunds = useMemo(() => {
        if (!livePrice || isPendingBalances) {
            return false;
        }
        if (!availableBalance) {
            return true;
        }
        return availableBalance.isLessThan(livePrice);
    }, [livePrice, availableBalance, isPendingBalances]);

    const handleBuy = async () => {
        if (!confirmPrice) return;

        const name = accountName.trim();
        if (!name) return;

        try {
            await buyName({
                accountName: name,
                maxCost: maxCostFromPrice(confirmPrice),
            });
            setPurchasedAccountName(name);
            setPurchaseComplete(true);
            form.reset();
        } catch (error) {
            setBuyConfirmOpen(false);
            setConfirmPrice(null);
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";

            let message: string | undefined;
            if (errorMessage.includes("has insufficient balance")) {
                message = "Insufficient balance";
            } else if (errorMessage.includes("Max cost below current ask")) {
                message =
                    "Market price changed; check new price and try again";
            } else if (!errorMessage.includes("Transaction error:")) {
                message = errorMessage;
            }
            if (message) {
                form.setFieldMeta("accountName", (prev) => ({
                    ...prev,
                    isTouched: true,
                    errors: [message],
                    errorMap: { onSubmit: message },
                }));
            }
        }
    };

    const validateAccountOnChange = ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        try {
            setIsAccountTaken(null);
            const value = zAccount.parse(rawValue);
            const isMarketAvailable = pricesRef.current.has(value.length);
            if (!isMarketAvailable) {
                throw `${value.length} character account names are not available`;
            }
        } catch (e) {
            if (e instanceof z.ZodError) return;
            if (typeof e === "string") return e;
            console.error("Failed to validate account name:", e);
        }
    };

    const validateAccountOnChangeAsync = async ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        try {
            const value = zAccount.parse(rawValue);
            const account = await getAccount(value);
            const taken = Boolean(account?.accountNum);
            setIsAccountTaken(taken);
            if (taken) return "Account name is already taken";

            if (!pricesRef.current.has(value.length)) {
                return `${value.length} character account names are not available`;
            }
        } catch (e) {
            if (e instanceof z.ZodError) return;
            console.error("Failed to validate account name");
            console.error(e);
            return "Failed to validate account name. Please try again.";
        }
    };

    const priceEndContent = () => (
        <form.Subscribe selector={(state) => [state.isFieldsValidating]}>
            {([isFieldsValidating]) =>
                isFieldsValidating ? (
                    <span className="shrink-0 pr-3 text-green-500">
                        <Spinner className="size-3.5 shrink-0" />
                    </span>
                ) : livePrice ? (
                    <span
                        className={`shrink-0 whitespace-nowrap pr-3 text-sm font-medium tabular-nums ${hasInsufficientFunds ? "text-red-500" : "text-green-500"}`}
                    >
                        Costs {livePrice.format({ includeLabel: true })}
                    </span>
                ) : null
            }
        </form.Subscribe>
    );

    return (
        <form.AppForm>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void form.handleSubmit();
                }}
            >
                <div className="flex flex-col gap-6">
                    <CardContent className="@container space-y-4">
                        <form.AppField
                            name="accountName"
                            asyncDebounceMs={500}
                            validators={{
                                onChange: validateAccountOnChange,
                                onChangeAsync: validateAccountOnChangeAsync,
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Desired account name"
                                    placeholder="Account name"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    endContent={priceEndContent()}
                                />
                            )}
                        />
                    </CardContent>
                    <CardFooter className="flex w-full items-center justify-between gap-4">
                        <AvailableBalanceLabel
                            systemToken={systemToken}
                            balance={availableBalance}
                            isPending={isPendingBalances}
                        />
                        <form.SubmitButton
                            labels={
                                hasInsufficientFunds
                                    ? ["Insufficient funds", "Processing"]
                                    : ["Buy", "Processing"]
                            }
                            disabled={isBuying || hasInsufficientFunds}
                        />
                    </CardFooter>
                </div>
            </form>
            {confirmPrice ? (
                <BuyNameConfirmationDialog
                    open={buyConfirmOpen}
                    setOpen={(open) => {
                        setBuyConfirmOpen(open);
                        if (!open) {
                            setConfirmPrice(null);
                            setPurchaseComplete(false);
                            setPurchasedAccountName(null);
                        }
                    }}
                    mode="buy-only"
                    account={purchasedAccountName ?? accountName}
                    price={confirmPrice}
                    isLoading={isBuying}
                    purchaseComplete={purchaseComplete}
                    claimPageHref={`/${ACCOUNT_MARKETPLACE_PATH}/claim`}
                    onConfirm={() => void handleBuy()}
                />
            ) : null}
        </form.AppForm>
    );
}
