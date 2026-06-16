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
                return validateDirtyMarkets(value, defaults, systemToken);
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
            <div>
                <h2 className="text-lg font-medium">
                    Premium Name Market Config
                </h2>
                <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
                    <li>
                        Each section is a premium account name length (
                        {MIN_ACCOUNT_NAME_LENGTH}–{MAX_ACCOUNT_NAME_LENGTH}{" "}
                        characters). Unconfigured lengths use defaults until you
                        save them.
                    </li>
                    <li>
                        Initial price applies only when creating a market and
                        cannot be changed afterward.
                    </li>
                    <li>
                        New markets start with purchases off. Use the switch on
                        each row to enable or disable purchases. Changes apply
                        when you save.
                    </li>
                    <li>
                        Floor price, target sales per 30-day window, and
                        increase/decrease PPM are editable below. Saving always
                        uses a 30-day DiffAdjust window.
                    </li>
                    <li>
                        Disabling purchases blocks new buys for that length;
                        existing purchases can still be claimed.
                    </li>
                </ul>
            </div>

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
                    className="space-y-6"
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

                    <div className="flex justify-end">
                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Save changes", "Saving…"]}
                                disabled={
                                    !isDirty || rowActionsDisabled || isSaving
                                }
                                loading={isSaving}
                            />
                        </form.AppForm>
                    </div>
                </form>
            )}
        </PageContainer>
    );
};
