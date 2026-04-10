import { AlertCircle, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { useAddPremiumNameMarket } from "@/hooks/premium-name-markets/use-add-market";
import { useBootstrapDefaultPremiumNameMarkets } from "@/hooks/premium-name-markets/use-bootstrap-default-markets";
import { useConfigurePremiumNameMarket } from "@/hooks/premium-name-markets/use-config-market";
import { useConfiguredPremiumNameMarkets } from "@/hooks/premium-name-markets/use-configured-markets";
import { useDisablePremiumNameMarket } from "@/hooks/premium-name-markets/use-disable-market";
import { useEnablePremiumNameMarket } from "@/hooks/premium-name-markets/use-enable-market";
import {
    MAX_PREMIUM_NAME_LENGTH_MARKET,
    MIN_PREMIUM_NAME_LENGTH_MARKET,
} from "@/lib/premium-name-market-defaults";

import { PageContainer } from "@shared/components/page-container";
import { useSystemToken } from "@shared/hooks/use-system-token";
import {
    MAX_PREMIUM_NAME_LENGTH,
    MIN_PREMIUM_NAME_LENGTH,
} from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionPrimitive,
} from "@shared/shadcn/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { Switch } from "@shared/shadcn/ui/switch";

import { AddMarketDialog } from "./premium-name-market/add-market-dialog";
import { NameMarketRowPanel } from "./premium-name-market/name-market-row-panel";

export const PremiumNameMarketConfig = () => {
    const { data: systemToken, isLoading: systemTokenLoading } =
        useSystemToken();
    const hasSystemToken = Boolean(systemToken?.id);
    const actionsDisabled = systemTokenLoading || !hasSystemToken;

    const {
        data: rows,
        isLoading,
        isError,
        error,
    } = useConfiguredPremiumNameMarkets();
    const {
        mutate: addMarket,
        isPending: isAdding,
        variables: addVars,
    } = useAddPremiumNameMarket();
    const {
        mutate: saveMarketConfig,
        isPending: savingConfig,
        variables: saveVars,
    } = useConfigurePremiumNameMarket();
    const {
        mutate: disablePurchases,
        isPending: disablingPurchases,
        variables: disableVars,
    } = useDisablePremiumNameMarket();
    const {
        mutate: enablePurchases,
        isPending: enablingPurchases,
        variables: enableVars,
    } = useEnablePremiumNameMarket();
    const { mutate: bootstrapNameMarkets, isPending: bootstrapping } =
        useBootstrapDefaultPremiumNameMarkets();

    const savingLength =
        savingConfig && saveVars !== undefined ? saveVars[0] : null;
    const disablingLength =
        disablingPurchases && disableVars !== undefined ? disableVars[0] : null;
    const enablingLength =
        enablingPurchases && enableVars !== undefined ? enableVars[0] : null;

    const [showAdd, setShowAdd] = useState(false);

    const allLengthMarketsCreated = useMemo(() => {
        if (isLoading || isError || !rows) {
            return false;
        }
        const lengths = new Set(rows.map((r) => r.length));
        for (
            let len = MIN_PREMIUM_NAME_LENGTH;
            len <= MAX_PREMIUM_NAME_LENGTH;
            len++
        ) {
            if (!lengths.has(len)) {
                return false;
            }
        }
        return true;
    }, [rows, isLoading, isError]);

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">
                    Premium Name Market Config
                </h2>
                <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
                    <li>
                        Each row is a premium account name length (1–
                        {MAX_PREMIUM_NAME_LENGTH} characters). When you add a
                        market, you set the initial price; it cannot be changed
                        later.
                    </li>
                    <li>
                        Use the switch on each row to turn purchases on or off
                        immediately.
                    </li>
                    <li>
                        Expand a row to edit floor price, target sales per
                        30-day window, and increase/decrease PPM (Save). Saving
                        always uses a 30-day DiffAdjust window.
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

            {!systemTokenLoading && !hasSystemToken ? (
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

            <div className="flex justify-end">
                <Button
                    type="button"
                    variant="outline"
                    disabled={
                        actionsDisabled ||
                        allLengthMarketsCreated ||
                        bootstrapping
                    }
                    onClick={() => setShowAdd(true)}
                >
                    + Add market
                </Button>
            </div>

            {!isLoading && !isError && (rows?.length ?? 0) === 0 ? (
                <div className="space-y-3 rounded-lg border border-dashed p-6">
                    <p className="text-muted-foreground text-sm">
                        <span className="text-foreground font-medium">
                            None
                        </span>{" "}
                        — no premium name markets are configured yet.
                    </p>
                    <Button
                        type="button"
                        disabled={actionsDisabled || bootstrapping}
                        onClick={() => bootstrapNameMarkets()}
                    >
                        {bootstrapping
                            ? "Configuring…"
                            : `Configure name markets ${MIN_PREMIUM_NAME_LENGTH_MARKET}-${MAX_PREMIUM_NAME_LENGTH_MARKET} with defaults`}
                    </Button>
                </div>
            ) : null}

            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : rows && rows.length > 0 ? (
                <div className="w-full overflow-hidden rounded-lg border">
                    <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 border-b px-4 py-3">
                        <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide">
                            Name Market
                        </div>
                        <div className="w-11 shrink-0 text-center text-[0.65rem] font-semibold uppercase leading-tight">
                            Enabled
                        </div>
                    </div>
                    <Accordion type="multiple" className="w-full px-4">
                        {rows.map((row) => {
                            const savingThis = savingLength === row.length;
                            const disablingThis =
                                disablingLength === row.length;
                            const enablingThis = enablingLength === row.length;
                            const toggleBusy =
                                savingThis || disablingThis || enablingThis;
                            return (
                                <AccordionItem
                                    key={row.length}
                                    value={String(row.length)}
                                >
                                    <AccordionPrimitive.Header className="flex w-full items-center gap-2">
                                        <AccordionPrimitive.Trigger
                                            className={cn(
                                                "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-4 pr-1 text-left text-sm font-medium outline-none transition-all hover:no-underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
                                            )}
                                        >
                                            <span className="flex min-w-0 flex-1 items-center gap-3">
                                                <span className="font-mono">
                                                    Length {row.length}
                                                </span>
                                                {!row.enabled ? (
                                                    <span className="text-destructive text-xs font-normal">
                                                        purchases off
                                                    </span>
                                                ) : null}
                                            </span>
                                            <ChevronDown className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
                                        </AccordionPrimitive.Trigger>
                                        <div
                                            className="flex w-11 shrink-0 justify-center py-4 pl-1"
                                            onClick={(e) => e.stopPropagation()}
                                            onPointerDown={(e) =>
                                                e.stopPropagation()
                                            }
                                            onKeyDown={(e) =>
                                                e.stopPropagation()
                                            }
                                        >
                                            <Switch
                                                checked={row.enabled}
                                                disabled={
                                                    actionsDisabled ||
                                                    toggleBusy
                                                }
                                                aria-label={`Purchases for length-${row.length} names`}
                                                onCheckedChange={(enable) => {
                                                    if (enable) {
                                                        enablePurchases([
                                                            row.length,
                                                        ]);
                                                    } else {
                                                        disablePurchases([
                                                            row.length,
                                                        ]);
                                                    }
                                                }}
                                            />
                                        </div>
                                    </AccordionPrimitive.Header>
                                    <AccordionContent>
                                        <NameMarketRowPanel
                                            row={row}
                                            saveConfig={saveMarketConfig}
                                            savingLength={savingLength}
                                            disablingLength={disablingLength}
                                            enablingLength={enablingLength}
                                            actionsDisabled={actionsDisabled}
                                        />
                                    </AccordionContent>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                </div>
            ) : null}

            <AddMarketDialog
                open={showAdd}
                onOpenChange={setShowAdd}
                rows={rows}
                actionsDisabled={actionsDisabled}
                allLengthMarketsCreated={allLengthMarketsCreated}
                addMarket={addMarket}
                isAdding={isAdding}
                addVars={addVars}
            />
        </PageContainer>
    );
};
