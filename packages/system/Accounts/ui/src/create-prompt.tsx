import { useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { prompt } from "@psibase/common-lib";

import { ConfirmKeyStep } from "@shared/components/account-key/confirm-key-step";
import { SaveKeyStep } from "@shared/components/account-key/save-key-step";
import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { useAppForm } from "@shared/components/form/app-form";
import { AvailableBalanceLabel } from "@shared/components/premium-accounts/available-balance-label";
import { BuyNameConfirmationDialog } from "@shared/components/premium-accounts/buy-name-confirmation-dialog";
import { useBranding } from "@shared/hooks/use-branding";
import { useCanBuyAccount } from "@shared/hooks/use-can-create-premium-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    useAccountMarkets,
} from "@shared/hooks/use-prem-markets";
import { useSystemToken } from "@shared/hooks/use-system-token";
import {
    getSystemTokenBalance,
    useUserTokenBalances,
} from "@shared/hooks/use-user-token-balances";
import { pemToB64 } from "@shared/lib/b64-key-utils";
import { getAccount } from "@shared/lib/get-account";
import { Quantity } from "@shared/lib/quantity";
import QueryKey from "@shared/lib/query-keys";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_FREE_ACCOUNT_NAME_LENGTH,
    zAccount,
    zAccountFree,
} from "@shared/lib/schemas/account";
import { accountMarketPricesFromOverview } from "@shared/lib/schemas/prem-accounts";
import {
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Progress } from "@shared/shadcn/ui/progress";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { Loader } from "./components/create-prompt/loader";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useCreateAccount } from "./hooks/use-create-account";
import { usePurchaseAccount } from "./hooks/use-purchase-account";

export const CreatePrompt = () => {
    const queryClient = useQueryClient();
    const { data: currentUser } = useCurrentUser();
    const [key, setKey] = useState<string>("");
    const [step, setStep] = useState<"1_CREATE" | "2_SAVE" | "3_CONFIRM">(
        "1_CREATE",
    );
    const [buyConfirmOpen, setBuyConfirmOpen] = useState(false);
    const [confirmPrice, setConfirmPrice] = useState<Quantity | null>(null);
    const [isAccountTaken, setIsAccountTaken] = useState<boolean | null>(null);

    const { data: networkName } = useBranding();
    const { data: systemToken, isPending: isPendingSystemToken } =
        useSystemToken();

    const { data: canBuyAccount, isPending: isPendingCanBuyAccount } =
        useCanBuyAccount();

    const { data: tokenBalances, isPending: isPendingBalances } =
        useUserTokenBalances(currentUser, {
            enabled: Boolean(currentUser && canBuyAccount),
        });

    const availableBalance = useMemo(
        () =>
            systemToken
                ? getSystemTokenBalance(tokenBalances, systemToken.id)
                : undefined,
        [tokenBalances, systemToken],
    );

    const { data: markets, isPending: isPendingMarkets } = useAccountMarkets({
        enabled: Boolean(canBuyAccount),
        refetchInterval: canBuyAccount
            ? ACCOUNT_MARKETS_REFETCH_INTERVAL_MS
            : false,
    });

    const prices = useMemo(
        () =>
            markets
                ? accountMarketPricesFromOverview(markets)
                : new Map<number, string>(),
        [markets],
    );

    const pricesRef = useRef(prices);
    pricesRef.current = prices;
    const isAccountTakenRef = useRef(isAccountTaken);
    isAccountTakenRef.current = isAccountTaken;

    const resolveLivePrice = useCallback(
        (rawAccountName: string): Quantity | null => {
            if (!canBuyAccount || !systemToken) {
                return null;
            }
            const parsed = zAccount.safeParse(rawAccountName.trim());
            if (
                !parsed.success ||
                isAccountTakenRef.current !== false ||
                parsed.data.length >= MIN_FREE_ACCOUNT_NAME_LENGTH
            ) {
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
        [canBuyAccount, systemToken],
    );

    const isLoading =
        isPendingSystemToken ||
        isPendingCanBuyAccount ||
        (canBuyAccount && isPendingMarkets);

    const createAccountMutation = useCreateAccount();
    const purchaseAccountMutation = usePurchaseAccount({
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: QueryKey.userTokenBalances(currentUser),
            });
        },
    });
    const connectAccountMutation = useConnectAccount();

    const accountValidator = canBuyAccount ? zAccount : zAccountFree;

    const createForm = useAppForm({
        defaultValues: {
            account: "",
        },
        validators: {
            onSubmit: z.object({
                account: accountValidator,
            }),
            onSubmitAsync: async ({ value }) => {
                const account = await getAccount(value.account);
                const taken = Boolean(account?.accountNum);
                setIsAccountTaken(taken);
                isAccountTakenRef.current = taken;

                const priceAtSubmit = taken
                    ? null
                    : resolveLivePrice(value.account);

                return {
                    fields: {
                        account: taken
                            ? "This account name is not available"
                            : canBuyAccount &&
                                zAccount.safeParse(value.account.trim())
                                    .success &&
                                value.account.trim().length <
                                    MIN_FREE_ACCOUNT_NAME_LENGTH &&
                                !priceAtSubmit
                              ? "Market price is not available for this name."
                              : undefined,
                    },
                };
            },
        },
        onSubmit: async (data) => {
            const priceAtSubmit = resolveLivePrice(data.value.account);
            if (priceAtSubmit) {
                setConfirmPrice(priceAtSubmit);
                setBuyConfirmOpen(true);
                return;
            }
            await handleCreateOrBuy(data.value.account);
        },
    });

    const handleCreateOrBuy = async (account: string) => {
        const name = account.trim();
        if (!name) return;
        const purchasePrice = confirmPrice;
        try {
            let privateKey: string;
            if (purchasePrice) {
                privateKey = await purchaseAccountMutation.mutateAsync([
                    name,
                    purchasePrice.format({
                        includeLabel: false,
                        fullPrecision: true,
                        showThousandsSeparator: false,
                    }),
                ]);
            } else {
                privateKey = await createAccountMutation.mutateAsync(name);
            }
            setKey(pemToB64(privateKey));
            setBuyConfirmOpen(false);
            setConfirmPrice(null);
            setStep("2_SAVE");
        } catch (error) {
            setBuyConfirmOpen(false);
            setConfirmPrice(null);
            console.error("Failed to secure account:");
            console.error(
                error instanceof Error ? error.message : "Unknown error",
            );
            let message = "An unknown error occurred";
            if (
                error instanceof Error &&
                error.message.includes("Invalid account name")
            ) {
                message = "This account name is not available";
            } else if (
                error instanceof Error &&
                error.message.includes("has insufficient balance")
            ) {
                message = "Insufficient balance";
            } else if (
                error instanceof Error &&
                error.message.includes("Max cost below current ask")
            ) {
                message = "Market price changed; check new price and try again";
            }
            createForm.setFieldMeta("account", (prev) => ({
                ...prev,
                isTouched: true,
                errors: [message],
                errorMap: { onSubmit: message },
            }));
        }
    };

    const createdAccount = useStore(
        createForm.store,
        (state) => state.values.account,
    );

    const livePrice = useMemo(
        () => resolveLivePrice(createdAccount),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- prices, isAccountTaken
        [createdAccount, prices, isAccountTaken, resolveLivePrice],
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

    if (isLoading) {
        return <Loader />;
    }

    const validateAccountOnChange = ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        if (!canBuyAccount) {
            return;
        }
        try {
            setIsAccountTaken(null);
            const value = zAccount.parse(rawValue);
            if (value.length >= MIN_FREE_ACCOUNT_NAME_LENGTH) {
                return;
            }
            if (!pricesRef.current.has(value.length)) {
                return `${value.length} character account names are not available`;
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
            const value = accountValidator.parse(rawValue);

            const account = await getAccount(value);
            const taken = Boolean(account?.accountNum);
            setIsAccountTaken(taken);
            isAccountTakenRef.current = taken;
            if (taken) return "Account name is already taken";

            if (canBuyAccount && value.length < MIN_FREE_ACCOUNT_NAME_LENGTH) {
                if (!pricesRef.current.has(value.length)) {
                    return `${value.length} character account names are not available`;
                }
            }
        } catch (e) {
            if (e instanceof z.ZodError) return;
            console.error("Failed to validate account name");
            console.error(e);
            return "Failed to validate account name. Please try again.";
        }
    };

    const priceEndContent = () => (
        <createForm.Subscribe selector={(state) => [state.isFieldsValidating]}>
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
        </createForm.Subscribe>
    );

    return (
        <BrandedGlowingCard>
            <div className="-mt-6 px-6">
                <Progress
                    value={
                        step === "1_CREATE" ? 33 : step === "2_SAVE" ? 67 : 100
                    }
                />
            </div>
            {step === "1_CREATE" && (
                <createForm.AppForm>
                    <form
                        id="create-account-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void createForm.handleSubmit();
                        }}
                        className="flex flex-col gap-6"
                    >
                        <CardContent className="flex flex-col">
                            <div className="mb-6 flex-1 space-y-2">
                                <CardTitle className="text-3xl font-normal">
                                    Create a {networkName} account
                                </CardTitle>
                                <CardDescription>
                                    {canBuyAccount
                                        ? `Account names can be up to ${MAX_ACCOUNT_NAME_LENGTH} characters long, must start with a letter, and can only contain letters, numbers, and underscores.`
                                        : `Account names can be ${MIN_FREE_ACCOUNT_NAME_LENGTH}-${MAX_ACCOUNT_NAME_LENGTH} characters long, must start with a letter, and can only contain letters, numbers, and underscores.`}
                                </CardDescription>
                            </div>
                            <createForm.AppField
                                name="account"
                                children={(field) => (
                                    <field.TextField
                                        label="Account name"
                                        placeholder="Account name"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        endContent={priceEndContent()}
                                    />
                                )}
                                asyncDebounceMs={500}
                                validators={{
                                    onChange: validateAccountOnChange,
                                    onChangeAsync: validateAccountOnChangeAsync,
                                }}
                            />
                        </CardContent>
                        <CardFooter
                            className={
                                livePrice
                                    ? "flex w-full items-center justify-between gap-4"
                                    : "flex flex-1 justify-end"
                            }
                        >
                            {livePrice && systemToken ? (
                                <AvailableBalanceLabel
                                    systemToken={systemToken}
                                    balance={availableBalance}
                                    isPending={isPendingBalances}
                                />
                            ) : null}
                            <createForm.SubmitButton
                                labels={
                                    hasInsufficientFunds
                                        ? ["Insufficient funds", "Buying..."]
                                        : livePrice
                                          ? ["Buy now", "Buying..."]
                                          : ["Create", "Creating..."]
                                }
                                disabled={
                                    hasInsufficientFunds ||
                                    (livePrice
                                        ? purchaseAccountMutation.isPending
                                        : false)
                                }
                            />
                        </CardFooter>
                    </form>
                    {confirmPrice ? (
                        <BuyNameConfirmationDialog
                            open={buyConfirmOpen}
                            setOpen={(open) => {
                                setBuyConfirmOpen(open);
                                if (!open) {
                                    setConfirmPrice(null);
                                }
                            }}
                            mode="buy-and-claim"
                            account={createdAccount}
                            price={confirmPrice}
                            isLoading={purchaseAccountMutation.isPending}
                            onConfirm={() =>
                                void handleCreateOrBuy(createdAccount)
                            }
                        />
                    ) : null}
                </createForm.AppForm>
            )}

            {step === "2_SAVE" && (
                <SaveKeyStep
                    accountName={createdAccount}
                    keyB64={key}
                    onContinue={() => setStep("3_CONFIRM")}
                />
            )}

            {step === "3_CONFIRM" && (
                <ConfirmKeyStep
                    expectedAccount={createdAccount}
                    onBack={() => setStep("2_SAVE")}
                    onImported={async (account) => {
                        await connectAccountMutation.mutateAsync(account);
                        prompt.finished();
                    }}
                />
            )}
        </BrandedGlowingCard>
    );
};
