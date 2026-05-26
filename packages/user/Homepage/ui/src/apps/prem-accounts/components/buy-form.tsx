import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo } from "react";

import { useAccountAvailability } from "@/apps/prem-accounts/hooks/use-account-availability";
import { useBuyName } from "@/apps/prem-accounts/hooks/use-buy-name";
import { useValidatedMaxCost } from "@/apps/prem-accounts/hooks/use-validated-max-cost";
import {
    defaultBuyFormValues,
    zBuyForm,
} from "@/apps/prem-accounts/lib/buy-form-schema";
import {
    formatCanonicalPrice,
    unitTokenDecimal,
} from "@/apps/prem-accounts/lib/format-token";

import { useAppForm } from "@shared/components/form/app-form";
import { GlowingCard } from "@shared/components/glowing-card";
import { usePremPrices } from "@shared/hooks/use-prem-prices";
import { useSystemToken } from "@shared/hooks/use-system-token";
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
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export function BuyForm() {
    const {
        data: priceByLength,
        isSuccess: hasLoadedPrices,
        isPending: isPendingPrices,
    } = usePremPrices();
    const {
        data: systemToken,
        isSuccess: hasLoadedToken,
        isPending: isPendingToken,
    } = useSystemToken();
    const hasSystemToken = Boolean(systemToken?.id);
    const tokenId = hasSystemToken ? Number(systemToken!.id) : undefined;
    const { mutateAsync: buyName, isPending: isBuying } = useBuyName();

    const form = useAppForm({
        defaultValues: defaultBuyFormValues,
        onSubmit: async ({ value }) => {
            const parsed = zBuyForm.parse(value);
            await buyName({
                accountName: parsed.accountName,
                maxCost: parsed.maxCost,
            });
            form.reset();
            if (hasSystemToken && systemToken) {
                form.setFieldValue(
                    "maxCost",
                    unitTokenDecimal(systemToken.precision),
                );
            }
        },
        validators: {
            onSubmit: zBuyForm,
        },
    });

    useEffect(() => {
        if (!hasLoadedToken || !hasSystemToken || !systemToken) {
            return;
        }
        if (form.state.values.maxCost === "") {
            form.setFieldValue(
                "maxCost",
                unitTokenDecimal(systemToken.precision),
            );
        }
    }, [form, hasLoadedToken, hasSystemToken, systemToken]);

    const accountName = useStore(
        form.store,
        (state) => state.values.accountName,
    );
    const maxCost = useStore(form.store, (state) => state.values.maxCost);

    const trimmedAccount = accountName.trim();
    const nameZodResult =
        trimmedAccount.length > 0 ? zAccount.safeParse(trimmedAccount) : null;
    const nameValidationMessage =
        nameZodResult && !nameZodResult.success
            ? (nameZodResult.error.issues[0]?.message ?? "Invalid account name")
            : "";

    const { data: availability } = useAccountAvailability(accountName);
    const { data: validatedMaxCostU64, isPending: isPendingMaxCostValidation } =
        useValidatedMaxCost(maxCost, tokenId);

    const price = useMemo(() => {
        if (!priceByLength || availability !== "available") {
            return null;
        }
        return priceByLength.get(trimmedAccount.length) ?? null;
    }, [availability, priceByLength, trimmedAccount.length]);

    const maxCostLabel = hasSystemToken ? systemToken!.symbol : "SysToken";

    const noMarketForNameLength =
        hasLoadedPrices &&
        availability === "available" &&
        trimmedAccount.length > 0 &&
        priceByLength !== undefined &&
        !priceByLength.has(trimmedAccount.length);

    const canBuy =
        hasLoadedToken &&
        hasSystemToken &&
        validatedMaxCostU64 !== undefined &&
        !isPendingMaxCostValidation &&
        nameZodResult?.success === true &&
        availability === "available" &&
        price !== null &&
        !isBuying;

    const isLoadingForm = isPendingPrices || isPendingToken;

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Buy a name</CardTitle>
                <CardDescription>
                    Purchase a premium account name.
                </CardDescription>
            </CardHeader>
            <form.AppForm>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    {isLoadingForm ? (
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
                        <CardContent className="@container space-y-4">
                            <div className="@xl:flex-row flex w-full flex-col gap-4">
                                <div className="flex-1">
                                    <form.AppField
                                        name="accountName"
                                        children={(field) => (
                                            <field.TextField
                                                label="Desired account name"
                                                placeholder={`e.g. my-name (${MIN_ACCOUNT_NAME_LENGTH}-${MAX_ACCOUNT_NAME_LENGTH} chars)`}
                                                autoComplete="off"
                                                autoCorrect="off"
                                                spellCheck={false}
                                            />
                                        )}
                                    />
                                </div>
                                <div className="min-w-56">
                                    <form.AppField
                                        name="maxCost"
                                        children={(field) => (
                                            <field.TextField
                                                label={`Max cost (${maxCostLabel})`}
                                                placeholder={
                                                    hasSystemToken &&
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
                            <div className="min-h-6 text-sm">
                                {nameValidationMessage && (
                                    <p className="text-destructive">
                                        {nameValidationMessage}
                                    </p>
                                )}
                                {!nameValidationMessage &&
                                    trimmedAccount.length > 0 &&
                                    nameZodResult?.success && (
                                        <>
                                            {availability === "taken" && (
                                                <p className="text-destructive">
                                                    Account name already exists
                                                </p>
                                            )}
                                            {availability === "available" &&
                                                price !== null &&
                                                hasSystemToken &&
                                                systemToken &&
                                                tokenId !== undefined && (
                                                    <p className="text-green-600">
                                                        Buy for{" "}
                                                        {formatCanonicalPrice(
                                                            price,
                                                            systemToken.precision,
                                                            tokenId,
                                                            systemToken.symbol,
                                                        )}
                                                    </p>
                                                )}
                                            {availability === "available" &&
                                                price === null &&
                                                !hasLoadedPrices && (
                                                    <p className="text-muted-foreground">
                                                        Loading price...
                                                    </p>
                                                )}
                                            {noMarketForNameLength && (
                                                <p className="text-muted-foreground">
                                                    {trimmedAccount} is not a
                                                    premium name.
                                                </p>
                                            )}
                                        </>
                                    )}
                                {maxCost.trim().length > 0 &&
                                    !isPendingMaxCostValidation &&
                                    validatedMaxCostU64 === undefined &&
                                    hasSystemToken && (
                                        <p className="text-destructive">
                                            Enter a valid max cost amount.
                                        </p>
                                    )}
                            </div>
                        </CardContent>
                    )}
                    <CardFooter>
                        <CardAction className="flex w-full justify-end">
                            <form.SubmitButton
                                labels={["Buy", "Processing..."]}
                                disabled={!canBuy}
                            />
                        </CardAction>
                    </CardFooter>
                </form>
            </form.AppForm>
        </GlowingCard>
    );
}
