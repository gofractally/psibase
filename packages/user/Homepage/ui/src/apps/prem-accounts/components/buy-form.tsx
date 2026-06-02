import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import { useState } from "react";
import z from "zod";

import { useBuyName } from "@/apps/prem-accounts/hooks/use-buy-name";

import { useAppForm } from "@shared/components/form/app-form";
import { getAccount } from "@shared/lib/get-account";
import { fetchCurrentPriceForLength } from "@shared/lib/graphql/prem-accounts";
import { Quantity } from "@shared/lib/quantity";
import { zAccount } from "@shared/lib/schemas/account";
import { CardAction, CardContent, CardFooter } from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { Spinner } from "@shared/shadcn/ui/spinner";

const DEFAULT_NAME_PURCHASE_SLIPPAGE = "5";

function parseSlippagePercent(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "" || !/^\d*\.?\d+$/.test(trimmed)) {
        return null;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
        return null;
    }
    return value;
}

function maxCostFromPriceAndSlippage(
    price: Quantity,
    slippagePercent: number,
): string {
    return price
        .multiply(1 + slippagePercent / 100)
        .format({
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
    const [price, setPrice] = useState<Quantity | null>(null);

    const { mutateAsync: buyName, isPending: isBuying } = useBuyName();

    const form = useAppForm({
        defaultValues: {
            accountName: "",
            slippage: DEFAULT_NAME_PURCHASE_SLIPPAGE,
        },
        onSubmit: async ({ value }) => {
            const slippagePercent = parseSlippagePercent(value.slippage);
            if (slippagePercent === null) {
                form.fieldInfo.slippage.instance?.setErrorMap({
                    onSubmit: "Enter a valid slippage percentage.",
                });
                return;
            }

            if (!price) {
                form.fieldInfo.accountName.instance?.setErrorMap({
                    onSubmit:
                        "Market price is not available. Check the account name and try again.",
                });
                return;
            }

            try {
                await buyName({
                    accountName: value.accountName,
                    maxCost: maxCostFromPriceAndSlippage(price, slippagePercent),
                });
                form.reset();
                form.setFieldValue("slippage", DEFAULT_NAME_PURCHASE_SLIPPAGE);
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
                    form.fieldInfo.accountName.instance?.setErrorMap({
                        onSubmit:
                            "Market price changed; check new price and try again",
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
                slippage: z.string(),
            }),
            onSubmitAsync: async ({ value }) => {
                let taken = false;
                const slippagePercent = parseSlippagePercent(value.slippage);

                try {
                    const account = await getAccount(value.accountName);
                    taken = Boolean(account?.accountNum);
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
                        accountName: taken
                            ? "This account name is not available"
                            : undefined,
                        slippage:
                            slippagePercent === null
                                ? "Enter a valid slippage percentage."
                                : !price
                                  ? "Market price is not available for this name."
                                  : undefined,
                    },
                };
            },
        },
    });

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

    const validateSlippageOnChange = ({ value }: { value: string }) => {
        const trimmed = value.trim();
        if (trimmed === "") return;
        if (!/^\d*\.?\d*$/.test(trimmed)) {
            return "Enter a valid slippage percentage.";
        }
        const num = Number(trimmed);
        if (!Number.isFinite(num) || num < 0) {
            return "Enter a valid slippage percentage.";
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
                                    name="slippage"
                                    validators={{
                                        onChange: validateSlippageOnChange,
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Slippage"
                                            placeholder={
                                                DEFAULT_NAME_PURCHASE_SLIPPAGE
                                            }
                                            autoComplete="off"
                                            inputMode="decimal"
                                            endContent={
                                                <span className="pr-3 text-sm">
                                                    %
                                                </span>
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
                                disabled={isBuying}
                            />
                        </CardAction>
                    </CardFooter>
                </div>
            </form>
        </form.AppForm>
    );
}
