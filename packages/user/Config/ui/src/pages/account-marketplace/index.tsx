import { useStore } from "@tanstack/react-form";
import { AlertCircle, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { useConfiguredNameMarkets } from "@/hooks/name-markets/use-configured-markets";
import { useSaveNameMarkets } from "@/hooks/name-markets/use-save-name-markets";
import {
    type NameMarketFormRow,
    buildNameMarketsFormValues,
    validateDirtyMarkets,
} from "@/lib/name-market-form";
import { scrollToFirstMarketFieldError } from "@/lib/name-market-validation-ui";

import { useAppForm } from "@shared/components/form/app-form";
import { LivePrice } from "@shared/components/live-price";
import { PageContainer } from "@shared/components/page-container";
import {
    ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    useAccountMarkets,
} from "@shared/hooks/use-account-markets";
import { useSystemToken } from "@shared/hooks/use-system-token";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";

import { NameMarketCardsSkeleton } from "./components/name-market-card-skeleton";
import {
    NameMarketRowPanel,
    type NameMarketRowPanelProps,
} from "./components/name-market-row-panel";

const MARKET_EDITABLE_FIELDS: Array<keyof NameMarketFormRow> = [
    "enabled",
    "initialPrice",
    "floorPrice",
    "windowAmount",
    "windowUnit",
    "target",
    "increasePct",
    "decreasePct",
];

const isMarketRowDirty = (
    fieldMeta: Record<string, { isDefaultValue?: boolean } | undefined>,
    index: number,
): boolean => {
    return MARKET_EDITABLE_FIELDS.some((field) => {
        const meta = fieldMeta[`markets[${index}].${field}`];
        return meta != null && meta.isDefaultValue === false;
    });
}

export const NameMarketConfig = () => {
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
    } = useConfiguredNameMarkets();

    const { data: liveMarkets } = useAccountMarkets({
        refetchInterval: ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
        enabled: !systemTokenLoading && systemToken !== undefined,
    });

    const livePriceByLength = useMemo(
        () => new Map(liveMarkets?.map((row) => [row.length, row.price]) ?? []),
        [liveMarkets],
    );

    const { mutateAsync: saveMarkets, isPending: isSaving } =
        useSaveNameMarkets();

    const defaultValues = useMemo(
        () => buildNameMarketsFormValues(rows),
        [rows],
    );

    const form = useAppForm({
        defaultValues,
        validators: {
            onSubmit: ({ value, formApi }) => {
                if (!systemToken) {
                    return undefined;
                }

                const { fieldMeta } = formApi.state;
                const validation = validateDirtyMarkets(
                    value,
                    systemToken,
                    (index) => isMarketRowDirty(fieldMeta, index),
                );

                if (validation?.fields) {
                    window.requestAnimationFrame(() => {
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

            const { fieldMeta } = formApi.state;
            const dirtyRows = value.markets.filter((_, index) =>
                isMarketRowDirty(fieldMeta, index),
            );
            if (dirtyRows.length === 0) {
                return;
            }

            await saveMarkets({ dirtyRows, systemToken });
            const { data: freshRows } = await refetch();
            formApi.reset(buildNameMarketsFormValues(freshRows));
        },
    });

    const isDirty = useStore(form.store, (state) => !state.isDefaultValue);

    const resetMarketRow = useCallback(
        (index: number) => {
            for (const field of MARKET_EDITABLE_FIELDS) {
                form.resetField(
                    `markets[${index}].${field}` as `markets[${number}].${typeof field}`,
                );
            }
        },
        [form],
    );

    const isMarketsLoading = systemTokenLoading || isLoading;
    const marketCardCount =
        MAX_ACCOUNT_NAME_LENGTH - MIN_ACCOUNT_NAME_LENGTH + 1;

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
                        Account Marketplace Config
                    </CardTitle>
                    <CardDescription>
                        Account name markets are configured by name length (
                        {MIN_ACCOUNT_NAME_LENGTH}–{MAX_ACCOUNT_NAME_LENGTH}{" "}
                        characters). Below, you can enable or disable individual
                        markets and set pricing parameters.
                    </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pt-0">
                    <ul className="text-muted-foreground marker:text-muted-foreground/50 list-disc space-y-1 pl-4 text-sm leading-relaxed">
                        <li>
                            Initial price is required when you first enable a
                            market; it cannot be changed later.
                        </li>
                        <li>
                            Changes are staged when you click the "Save changes"
                            button at the bottom of the page.
                        </li>
                        <li>
                            Disabling a market blocks new purchases for that
                            length; existing, unclaimed purchases can still be
                            claimed.
                        </li>
                        <li>
                            Each window ends when its time expires or sales
                            exceed the target. Exceeding the target raises price
                            by the increase % and starts a new window; falling
                            short at expiry lowers price by the decrease %;
                            meeting the target exactly starts a new window at
                            the same price.
                        </li>
                    </ul>
                </CardContent>
            </Card>

            {tokenMissingConfirmed ? (
                <Alert variant="warning">
                    <AlertCircle />
                    <AlertTitle variant="warning">
                        System token required
                    </AlertTitle>
                    <AlertDescription variant="warning">
                        <p>Set up a system token to use this feature</p>
                    </AlertDescription>
                </Alert>
            ) : null}

            {isError ? (
                <p className="text-destructive text-sm">
                    {error instanceof Error
                        ? error.message
                        : "Could not load account markets."}
                </p>
            ) : null}

            {isMarketsLoading ? (
                <NameMarketCardsSkeleton count={marketCardCount} />
            ) : (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                    className="pb-20"
                >
                    <form.Subscribe selector={(state) => state.values.markets}>
                        {(markets) => (
                            <div className="space-y-4">
                                {markets.map((market, index) => (
                                    <Card
                                        key={market.length}
                                        className={cn(
                                            "gap-0 py-0 shadow-sm",
                                            !market.configured &&
                                            "border-dashed",
                                        )}
                                    >
                                        <form.Subscribe
                                            selector={(state) => ({
                                                enabled:
                                                    state.values.markets[index]
                                                        ?.enabled,
                                                isRowDirty: isMarketRowDirty(
                                                    state.fieldMeta,
                                                    index,
                                                ),
                                            })}
                                        >
                                            {({ enabled, isRowDirty }) => (
                                                <>
                                                    <CardHeader
                                                        className={cn(
                                                            "flex items-center gap-4 px-4 py-3",
                                                            enabled &&
                                                            "[.border-b]:pb-3 border-b",
                                                        )}
                                                    >
                                                        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <CardTitle className="font-mono text-sm font-medium">
                                                                    Length{" "}
                                                                    {
                                                                        market.length
                                                                    }
                                                                </CardTitle>
                                                                {market.configured &&
                                                                    enabled &&
                                                                    systemToken ? (
                                                                    <LivePrice
                                                                        price={livePriceByLength.get(
                                                                            market.length,
                                                                        )}
                                                                        systemToken={
                                                                            systemToken
                                                                        }
                                                                        className="text-muted-foreground px-1 py-0.5 text-xs"
                                                                    />
                                                                ) : null}
                                                            </div>
                                                            <div
                                                                className={cn(
                                                                    "flex items-center gap-1.5",
                                                                    !isRowDirty &&
                                                                    "invisible",
                                                                )}
                                                                aria-hidden={
                                                                    !isRowDirty
                                                                }
                                                            >
                                                                <Badge
                                                                    variant="outline"
                                                                    className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                                                >
                                                                    Unsaved
                                                                    changes
                                                                </Badge>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon-sm"
                                                                    disabled={
                                                                        rowActionsDisabled ||
                                                                        isSaving
                                                                    }
                                                                    aria-label="Reset changes"
                                                                    onClick={() =>
                                                                        resetMarketRow(
                                                                            index,
                                                                        )
                                                                    }
                                                                >
                                                                    <Undo2 />
                                                                </Button>
                                                            </div>
                                                        </div>
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
                                                                            field
                                                                                .state
                                                                                .value
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
                                                    </CardHeader>
                                                    {enabled ? (
                                                        <CardContent className="px-4 py-3">
                                                            <NameMarketRowPanel
                                                                form={
                                                                    form as NameMarketRowPanelProps["form"]
                                                                }
                                                                index={index}
                                                                actionsDisabled={
                                                                    rowActionsDisabled ||
                                                                    isSaving
                                                                }
                                                            />
                                                        </CardContent>
                                                    ) : null}
                                                </>
                                            )}
                                        </form.Subscribe>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </form.Subscribe>

                    <div
                        className={cn(
                            "bg-background/95 supports-backdrop-filter:bg-background/80 fixed inset-x-0 bottom-0 z-20 border-t py-3 backdrop-blur",
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
