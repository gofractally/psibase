import { useStore } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import z from "zod";

import { useAccountAvailability } from "@/apps/prem-accounts/hooks/use-account-availability";
import { useBuyName } from "@/apps/prem-accounts/hooks/use-buy-name";
import { useValidatedMaxCost } from "@/apps/prem-accounts/hooks/use-validated-max-cost";
import { unitTokenDecimal } from "@/apps/prem-accounts/lib/format-token";

import { ErrorCard } from "@shared/components/error-card";
import { useAppForm } from "@shared/components/form/app-form";
import { GlowingCard } from "@shared/components/glowing-card";
import { usePremPrices } from "@shared/hooks/use-prem-prices";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { getAccount } from "@shared/lib/get-account";
import { fetchCurrentPriceForLength } from "@shared/lib/graphql/prem-accounts";
import { Quantity } from "@shared/lib/quantity";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
    zAccount,
} from "@shared/lib/schemas/account";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Spinner } from "@shared/shadcn/ui/spinner";

export function BuyForm() {
    const [price, setPrice] = useState<Quantity | null>(null);
    const [isLoadingFreshPrice, setIsLoadingFreshPrice] = useState(false);

    const {
        data: systemToken,
        isSuccess: hasLoadedToken,
        isPending: isPendingToken,
    } = useSystemToken();
    const {
        data: prices,
        isSuccess: hasLoadedPrices,
        isPending: isPendingPrices,
    } = usePremPrices();

    const { mutateAsync: buyName, isPending: isBuying } = useBuyName();

    const form = useAppForm({
        defaultValues: {
            accountName: "",
            maxCost: "",
        },
        onSubmit: async ({ value }) => {
            try {
                await buyName({
                    accountName: value.accountName,
                    maxCost: value.maxCost,
                });
                form.reset();
                form.setFieldValue(
                    "maxCost",
                    unitTokenDecimal(systemToken!.precision),
                );
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : "Unknown error";

                // transaction error: insufficient balance
                if (errorMessage.includes("has insufficient balance")) {
                    form.fieldInfo.accountName.instance?.setErrorMap({
                        onSubmit: "Insufficient balance",
                    });
                }

                // plugin error: max cost
                if (errorMessage.includes("Max cost below current ask")) {
                    form.fieldInfo.maxCost.instance?.setErrorMap({
                        onSubmit: "Max cost below current ask",
                    });
                }

                // all other plugin errors (non-transaction errors)
                if (!errorMessage.includes("Transaction error:")) {
                    form.fieldInfo.accountName.instance?.setErrorMap({
                        onSubmit: errorMessage,
                    });
                }
            }
        },
        validators: {
            onChange: z.object({
                accountName: zAccount.or(z.literal("")),
                maxCost: z.string(),
            }),
            onSubmitAsync: async ({ value }) => {
                const account = await getAccount(value.accountName);
                const trimmedMaxCost = value.maxCost.trim();
                return {
                    fields: {
                        account: account
                            ? "This account name is not available"
                            : undefined,
                        maxCost:
                            trimmedMaxCost.length > 0 &&
                            !isPendingMaxCostValidation &&
                            validatedMaxCostU64 === undefined
                                ? "Enter a valid max cost amount."
                                : undefined,
                    },
                };
            },
        },
    });

    useEffect(() => {
        if (!systemToken) return;
        if (form.state.values.maxCost === "") {
            form.setFieldValue(
                "maxCost",
                unitTokenDecimal(systemToken.precision),
            );
        }
    }, [form, systemToken]);

    const accountName = useStore(
        form.store,
        (state) => state.values.accountName,
    );
    const maxCost = useStore(form.store, (state) => state.values.maxCost);

    const { data: availability } = useAccountAvailability(accountName);
    const { data: validatedMaxCostU64, isPending: isPendingMaxCostValidation } =
        useValidatedMaxCost(maxCost, Number(systemToken?.id));

    if (hasLoadedToken && !systemToken) {
        return (
            <ErrorCard
                title="System token not found"
                error={new Error("Refresh the page and try again.")}
            />
        );
    }

    if (hasLoadedPrices && !prices) {
        return (
            <ErrorCard
                title="Premium account name pricing is not available"
                error={new Error("Refresh the page and try again.")}
            />
        );
    }

    const trimmedAccount = accountName.trim();
    const nameZodResult =
        trimmedAccount.length > 0 ? zAccount.safeParse(trimmedAccount) : null;
    const canBuy =
        systemToken &&
        validatedMaxCostU64 !== undefined &&
        !isPendingMaxCostValidation &&
        nameZodResult?.success === true &&
        availability === "available" &&
        price !== null &&
        !isBuying;

    const validateAccountOnChange = ({ value }: { value: string }) => {
        setPrice(null);

        if (
            value.length < MIN_ACCOUNT_NAME_LENGTH ||
            value.length > MAX_ACCOUNT_NAME_LENGTH
        ) {
            setIsLoadingFreshPrice(false);
            return;
        }

        const isMarketAvailable = prices?.has(value.length);
        if (!isMarketAvailable) {
            setIsLoadingFreshPrice(false);
            return `${value.length} character account names are not available`;
        }

        setIsLoadingFreshPrice(true);
    };

    const validateAccountOnChangeAsync = async ({
        value,
    }: {
        value: string;
    }) => {
        if (
            value.length < MIN_ACCOUNT_NAME_LENGTH ||
            value.length > MAX_ACCOUNT_NAME_LENGTH
        ) {
            setIsLoadingFreshPrice(false);
            return;
        }

        try {
            const account = await getAccount(value);
            const exists = Boolean(account?.accountNum);
            if (exists) {
                setIsLoadingFreshPrice(false);
                return "Account name is already taken";
            }

            const freshPrice = await fetchCurrentPriceForLength(value.length);
            const priceQuantity = new Quantity(
                freshPrice!,
                systemToken!.precision,
                Number(systemToken!.id),
                systemToken!.symbol,
            );
            setPrice(priceQuantity);
        } catch (e) {
            console.error("Failed to validate account name");
            console.error(e);
            return "Failed to validate account name. Please try again.";
        } finally {
            setIsLoadingFreshPrice(false);
        }
    };

    const priceLabel = isLoadingFreshPrice ? (
        <Spinner className="size-3.5 shrink-0" />
    ) : price ? (
        <Label className="text-green-500">
            Available for {price.format({ includeLabel: true })}
        </Label>
    ) : undefined;

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Buy a premium account name</CardTitle>
                <CardDescription>
                    Account names can be up to {MAX_ACCOUNT_NAME_LENGTH}{" "}
                    characters long, must start with a letter, and can only
                    contain letters, numbers, and underscores.
                </CardDescription>
            </CardHeader>
            <form.AppForm>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    {isPendingToken || isPendingPrices ? (
                        <CardContent className="space-y-4">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-40" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                                <Skeleton className="h-6 w-48" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        </CardContent>
                    ) : (
                        <div className="flex flex-col gap-6">
                            <CardContent className="@container space-y-4">
                                <div className="@xl:flex-row flex w-full flex-col gap-4">
                                    <div className="flex-1">
                                        <form.AppField
                                            name="accountName"
                                            validators={{
                                                onChange:
                                                    validateAccountOnChange,
                                                onChangeAsyncDebounceMs: 500,
                                                onChangeAsync:
                                                    validateAccountOnChangeAsync,
                                            }}
                                            children={(field) => (
                                                <field.TextField
                                                    label="Desired account name"
                                                    placeholder="Account name"
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                    rightLabel={priceLabel}
                                                />
                                            )}
                                        />
                                    </div>
                                    <div className="min-w-56">
                                        <form.AppField
                                            name="maxCost"
                                            children={(field) => (
                                                <field.TextField
                                                    label={`Max cost (${systemToken?.symbol ?? "SysToken"})`}
                                                    placeholder={
                                                        systemToken
                                                            ? unitTokenDecimal(
                                                                  systemToken.precision,
                                                              )
                                                            : "1.0000"
                                                    }
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter>
                                <CardAction className="flex w-full justify-end">
                                    <form.SubmitButton
                                        labels={["Buy", "Processing"]}
                                        disabled={!canBuy}
                                    />
                                </CardAction>
                            </CardFooter>
                        </div>
                    )}
                </form>
            </form.AppForm>
        </GlowingCard>
    );
}
