import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import { useEffect, useState } from "react";
import z from "zod";

import { useBuyName } from "@/apps/prem-accounts/hooks/use-buy-name";
import { unitTokenDecimal } from "@/apps/prem-accounts/lib/format-token";

import { useAppForm } from "@shared/components/form/app-form";
import { getAccount } from "@shared/lib/get-account";
import { fetchCurrentPriceForLength } from "@shared/lib/graphql/prem-accounts";
import { Quantity } from "@shared/lib/quantity";
import { zAccount } from "@shared/lib/schemas/account";
import { tokenDecimalToBigInt } from "@shared/lib/token-decimal-to-bigint";
import { CardAction, CardContent, CardFooter } from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { Spinner } from "@shared/shadcn/ui/spinner";

export function BuyForm({
    systemToken,
    prices,
}: {
    systemToken: SystemTokenInfo;
    prices: Map<number, string>;
}) {
    const [price, setPrice] = useState<Quantity | null>(null);

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
                    unitTokenDecimal(systemToken.precision),
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
                // TODO: Make sure the max cost validation stuff is working
                let taken = false;
                let validatedMaxCost: bigint | undefined;

                try {
                    const account = await getAccount(value.accountName);
                    taken = Boolean(account?.accountNum);
                    validatedMaxCost = await tokenDecimalToBigInt(
                        Number(systemToken.id),
                        value.maxCost.trim(),
                    );
                } catch (error) {
                    console.error("Error validating on submit:", error);
                    return {
                        fields: {
                            accountName:
                                "There was a problem submitting your request. Please try again.",
                        },
                    };
                }

                return {
                    fields: {
                        account: taken
                            ? "This account name is not available"
                            : undefined,
                        maxCost: !validatedMaxCost
                            ? "Enter a valid max cost amount."
                            : undefined,
                    },
                };
            },
        },
    });

    useEffect(() => {
        if (form.state.values.maxCost === "") {
            form.setFieldValue(
                "maxCost",
                unitTokenDecimal(systemToken.precision),
            );
        }
    }, [form, systemToken]);

    const validateAccountOnChange = ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        try {
            setPrice(null);
            const value = zAccount.parse(rawValue);
            const isMarketAvailable = prices.has(value.length);
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
            const exists = Boolean(account?.accountNum);
            if (exists) return "Account name is already taken";

            const freshPrice = await fetchCurrentPriceForLength(value.length);
            if (!freshPrice) {
                return `${value.length} character account names are not available`;
            }

            const priceQuantity = new Quantity(
                freshPrice,
                systemToken.precision,
                Number(systemToken.id),
                systemToken.symbol,
            );
            setPrice(priceQuantity);
        } catch (e) {
            if (e instanceof z.ZodError) return;
            console.error("Failed to validate account name");
            console.error(e);
            return "Failed to validate account name. Please try again.";
        }
    };

    const priceLabel = () => (
        <form.Subscribe selector={(state) => [state.isFieldsValidating]}>
            {([isFieldsValidating]) =>
                isFieldsValidating ? (
                    <Spinner className="size-3.5 shrink-0" />
                ) : price ? (
                    <Label className="text-green-500">
                        Available for {price.format({ includeLabel: true })}
                    </Label>
                ) : undefined
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
                        <div className="@xl:flex-row flex w-full flex-col gap-4">
                            <div className="flex-1">
                                <form.AppField
                                    name="accountName"
                                    asyncDebounceMs={500}
                                    validators={{
                                        onChange: validateAccountOnChange,
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
                                            rightLabel={priceLabel()}
                                        />
                                    )}
                                />
                            </div>
                            <div className="min-w-56">
                                <form.AppField
                                    name="maxCost"
                                    children={(field) => (
                                        <field.TextField
                                            label={`Max cost (${systemToken.symbol ?? "SysToken"})`}
                                            placeholder={unitTokenDecimal(
                                                systemToken.precision,
                                            )}
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
                                disabled={isBuying}
                            />
                        </CardAction>
                    </CardFooter>
                </div>
            </form>
        </form.AppForm>
    );
}
