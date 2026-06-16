import { useStore } from "@tanstack/react-form";
import { AlertCircle } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useConfiguredPremiumNameMarkets } from "@/hooks/premium-name-markets/use-configured-markets";
import { useSavePremiumNameMarkets } from "@/hooks/premium-name-markets/use-save-premium-name-markets";
import {
    type PremiumNameMarketsFormValues,
    buildPremiumNameMarketsFormValues,
    getDirtyMarkets,
    validateDirtyMarkets,
} from "@/lib/premium-name-market-form";
import { scrollToFirstMarketFieldError } from "@/lib/premium-name-market-validation-ui";

import { useAppForm } from "@shared/components/form/app-form";
import { PageContainer } from "@shared/components/page-container";
import { useSystemToken } from "@shared/hooks/use-system-token";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { Badge } from "@shared/shadcn/ui/badge";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";

import {
    NameMarketRowPanel,
    type NameMarketRowPanelProps,
} from "./premium-name-market/name-market-row-panel";

export const PremiumNameMarketConfig = () => {
    const { data: systemToken, isLoading: systemTokenLoading } =
        useSystemToken();
    const rowActionsDisabled = !systemToken;
    const tokenMissingConfirmed = systemToken === null;

    const {
        data: rows,
        isLoading,
        isError,
        error,
        refetch,
    } = useConfiguredPremiumNameMarkets();

    const { mutateAsync: saveMarkets, isPending: isSaving } =
        useSavePremiumNameMarkets();

    const defaultValues = useMemo(
        () => buildPremiumNameMarketsFormValues(rows),
        [rows],
    );

    const form = useAppForm({
        defaultValues,
        validators: {
            onSubmit: ({ value, formApi }) => {
                if (!systemToken) {
                    return undefined;
                }

                const defaults = formApi.options
                    .defaultValues as PremiumNameMarketsFormValues;
                const validation = validateDirtyMarkets(
                    value,
                    defaults,
                    systemToken,
                );

                if (validation?.fields) {
                    window.requestAnimationFrame(() => {
                        for (const fieldPath of Object.keys(
                            validation.fields,
                        )) {
                            form.setFieldMeta(
                                fieldPath as `markets[${number}].initialPrice`,
                                (prev) => ({
                                    ...prev,
                                    isTouched: true,
                                }),
                            );
                        }
                        scrollToFirstMarketFieldError(validation.fields);
                    });
                }

                return validation;
            },
        },
        onSubmit: async ({ value, formApi }) => {
            if (!systemToken) {
                return;
            }

            const defaults = formApi.options
                .defaultValues as PremiumNameMarketsFormValues;
            const dirtyRows = getDirtyMarkets(value, defaults);
            if (dirtyRows.length === 0) {
                return;
            }

            await saveMarkets({ dirtyRows, systemToken });
            const { data: freshRows } = await refetch();
            formApi.reset(buildPremiumNameMarketsFormValues(freshRows));
        },
    });

    const isDirty = useStore(form.store, (state) => state.isDirty);

    useEffect(() => {
        if (isLoading || isSaving || isDirty) {
            return;
        }
        form.reset(defaultValues);
    }, [defaultValues, form, isLoading, isSaving, isDirty]);

    return (
        <PageContainer className="space-y-6">
            <Card className="gap-4 py-4 shadow-sm">
                <CardHeader className="gap-1.5 px-4">
                    <CardTitle className="text-lg font-medium">
                        Premium Name Market Config
                    </CardTitle>
                    <CardDescription>
                        Set pricing, targets, and purchase availability for
                        each premium name length.
                    </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pt-0">
                    <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-sm leading-relaxed marker:text-muted-foreground/50">
                        <li>
                            One card per premium name length (
                            {MIN_ACCOUNT_NAME_LENGTH}–{MAX_ACCOUNT_NAME_LENGTH}{" "}
                            characters). Dashed cards are not configured yet;
                            saving creates them with the values you enter.
                        </li>
                        <li>
                            Initial price is required when creating a market and
                            cannot be changed afterward.
                        </li>
                        <li>
                            Unconfigured markets default to purchases off. Use
                            the Enabled switch on each card to allow or block
                            new purchases.
                        </li>
                        <li>
                            Floor price, target per month, and increase/decrease
                            percentages can be edited on any card. The adjustment
                            window is always 30 days and is not editable here.
                        </li>
                        <li>
                            Nothing is staged until you click Save changes at
                            the bottom of the page; only lengths you modified
                            are submitted.
                        </li>
                        <li>
                            Disabling purchases blocks new buys for that length;
                            existing purchases can still be claimed.
                        </li>
                    </ul>
                </CardContent>
            </Card>

            {systemTokenLoading ? (
                <p className="text-muted-foreground text-sm">
                    Checking system token…
                </p>
            ) : null}

            {tokenMissingConfirmed ? (
                <Alert variant="warning" className="max-w-2xl">
                    <AlertCircle />
                    <AlertTitle variant="warning">
                        System token required
                    </AlertTitle>
                    <AlertDescription variant="warning">
                        <p>
                            No system token configured yet. All Premium name
                            markets rely on a sys token for pricing.
                        </p>
                    </AlertDescription>
                </Alert>
            ) : null}

            {isError ? (
                <p className="text-destructive text-sm">
                    {error instanceof Error
                        ? error.message
                        : "Could not load premium name markets."}
                </p>
            ) : null}

            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                    className="pb-20"
                >
                    <div className="space-y-4">
                        {defaultValues.markets.map((market, index) => (
                            <Card
                                key={market.length}
                                className={cn(
                                    "gap-0 py-0 shadow-sm",
                                    !market.configured && "border-dashed",
                                )}
                            >
                                <CardHeader className="border-b px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <CardTitle className="font-mono text-sm font-medium">
                                            Length {market.length}
                                        </CardTitle>
                                        {!market.configured ? (
                                            <Badge variant="outline">
                                                Not configured
                                            </Badge>
                                        ) : null}
                                        <form.Subscribe
                                            selector={(state) =>
                                                state.values.markets[index]
                                                    ?.enabled
                                            }
                                        >
                                            {(enabled) =>
                                                enabled === false ? (
                                                    <Badge variant="secondary">
                                                        Purchases off
                                                    </Badge>
                                                ) : null
                                            }
                                        </form.Subscribe>
                                    </div>
                                    <CardAction>
                                        <div className="flex items-center gap-2">
                                            <Label
                                                htmlFor={`pm-enabled-${index}`}
                                                className="text-muted-foreground text-xs font-normal"
                                            >
                                                Enabled
                                            </Label>
                                            <form.Field
                                                name={`markets[${index}].enabled`}
                                            >
                                                {(field) => (
                                                    <Switch
                                                        id={`pm-enabled-${index}`}
                                                        checked={
                                                            field.state.value
                                                        }
                                                        disabled={
                                                            rowActionsDisabled ||
                                                            isSaving
                                                        }
                                                        aria-label={`Purchases for length-${market.length} names`}
                                                        onCheckedChange={
                                                            field.handleChange
                                                        }
                                                    />
                                                )}
                                            </form.Field>
                                        </div>
                                    </CardAction>
                                </CardHeader>
                                <CardContent className="px-4 py-3">
                                    <NameMarketRowPanel
                                        form={
                                            form as NameMarketRowPanelProps["form"]
                                        }
                                        index={index}
                                        actionsDisabled={
                                            rowActionsDisabled || isSaving
                                        }
                                    />
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div
                        className={cn(
                            "fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 py-3 backdrop-blur supports-backdrop-filter:bg-background/80",
                            "md:left-[var(--sidebar-width)]",
                            "md:group-data-[collapsible=icon]/sidebar-wrapper:left-[calc(var(--sidebar-width-icon)+(--spacing(4)))]",
                        )}
                    >
                        <div className="mx-auto flex w-full max-w-5xl justify-end px-6">
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Save changes", "Saving…"]}
                                    disabled={
                                        !isDirty ||
                                        rowActionsDisabled ||
                                        isSaving
                                    }
                                    loading={isSaving}
                                />
                            </form.AppForm>
                        </div>
                    </div>
                </form>
            )}
        </PageContainer>
    );
};
