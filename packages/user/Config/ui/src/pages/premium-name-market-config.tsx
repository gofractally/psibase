import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAddPremiumNameMarket } from "@/hooks/premium-name-markets/use-add-market";
import { useBootstrapDefaultPremiumNameMarkets } from "@/hooks/premium-name-markets/use-bootstrap-default-markets";
import { useConfigurePremiumNameMarket } from "@/hooks/premium-name-markets/use-config-market";
import {
    type ConfiguredPremiumNameMarketRow,
    useConfiguredPremiumNameMarkets,
} from "@/hooks/premium-name-markets/use-configured-markets";
import { useDisablePremiumNameMarket } from "@/hooks/premium-name-markets/use-disable-market";
import { useEnablePremiumNameMarket } from "@/hooks/premium-name-markets/use-enable-market";
import {
    PREMIUM_MARKET_DEFAULTS,
    PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
} from "@/lib/premium-name-market-defaults";

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
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";

function parseNameLength(raw: string): number | null {
    const t = raw.trim();
    if (!t) return null;
    if (t.length > 2) return null;
    if (!/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (
        !Number.isFinite(n) ||
        n < MIN_PREMIUM_NAME_LENGTH ||
        n > MAX_PREMIUM_NAME_LENGTH
    ) {
        return null;
    }
    return n;
}

function parsePositiveInt(raw: string): number | null {
    const t = raw.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n;
}

function parsePpm(raw: string): number | null {
    const t = raw.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1 || n >= 1_000_000) return null;
    return n;
}

function NameMarketRowPanel({
    row,
    saveConfig,
    savingLength,
    disablingLength,
    enablingLength,
}: {
    row: ConfiguredPremiumNameMarketRow;
    saveConfig: ReturnType<typeof useConfigurePremiumNameMarket>["mutate"];
    savingLength: number | null;
    disablingLength: number | null;
    enablingLength: number | null;
}) {
    const [floorPrice, setFloorPrice] = useState(row.floorPrice);
    const [targetRaw, setTargetRaw] = useState(String(row.target));
    const [increasePpmRaw, setIncreasePpmRaw] = useState(
        String(row.increasePpm),
    );
    const [decreasePpmRaw, setDecreasePpmRaw] = useState(
        String(row.decreasePpm),
    );

    useEffect(() => {
        setFloorPrice(row.floorPrice);
        setTargetRaw(String(row.target));
        setIncreasePpmRaw(String(row.increasePpm));
        setDecreasePpmRaw(String(row.decreasePpm));
    }, [
        row.length,
        row.floorPrice,
        row.target,
        row.increasePpm,
        row.decreasePpm,
    ]);

    const target = parsePositiveInt(targetRaw);
    const increasePpm = parsePpm(increasePpmRaw);
    const decreasePpm = parsePpm(decreasePpmRaw);
    const pricesOk =
        floorPrice.trim() !== "" &&
        target !== null &&
        increasePpm !== null &&
        decreasePpm !== null;

    return (
        <div className="flex max-w-lg flex-col gap-4 pt-2">
            <div className="grid gap-2">
                <Label htmlFor={`pm-floor-${row.length}`}>Floor price</Label>
                <Input
                    id={`pm-floor-${row.length}`}
                    value={floorPrice}
                    onChange={(e) => setFloorPrice(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-target-${row.length}`}>
                    Target sales per window
                </Label>
                <Input
                    id={`pm-target-${row.length}`}
                    inputMode="numeric"
                    value={targetRaw}
                    onChange={(e) => setTargetRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-inc-ppm-${row.length}`}>Increase PPM</Label>
                <Input
                    id={`pm-inc-ppm-${row.length}`}
                    inputMode="numeric"
                    value={increasePpmRaw}
                    onChange={(e) => setIncreasePpmRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-dec-ppm-${row.length}`}>Decrease PPM</Label>
                <Input
                    id={`pm-dec-ppm-${row.length}`}
                    inputMode="numeric"
                    value={decreasePpmRaw}
                    onChange={(e) => setDecreasePpmRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                />
            </div>
            <Button
                type="button"
                disabled={
                    !pricesOk ||
                    savingLength === row.length ||
                    disablingLength === row.length ||
                    enablingLength === row.length
                }
                onClick={() => {
                    if (
                        target === null ||
                        increasePpm === null ||
                        decreasePpm === null
                    ) {
                        return;
                    }
                    saveConfig([
                        row.length,
                        PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
                        target,
                        floorPrice.trim(),
                        increasePpm,
                        decreasePpm,
                    ]);
                }}
            >
                {savingLength === row.length ? "Saving…" : "Save parameters"}
            </Button>
        </div>
    );
}

export const PremiumNameMarketConfig = () => {
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
    const [newLengthRaw, setNewLengthRaw] = useState("");
    const [addInitial, setAddInitial] = useState<string>(
        PREMIUM_MARKET_DEFAULTS.initialPrice,
    );
    const [addFloor, setAddFloor] = useState<string>(
        PREMIUM_MARKET_DEFAULTS.floorPrice,
    );
    const [addTargetRaw, setAddTargetRaw] = useState(
        String(PREMIUM_MARKET_DEFAULTS.target),
    );
    const [addIncreasePpmRaw, setAddIncreasePpmRaw] = useState(
        String(PREMIUM_MARKET_DEFAULTS.increasePpm),
    );
    const [addDecreasePpmRaw, setAddDecreasePpmRaw] = useState(
        String(PREMIUM_MARKET_DEFAULTS.decreasePpm),
    );

    const parsedLength = useMemo(
        () => parseNameLength(newLengthRaw),
        [newLengthRaw],
    );

    const addTarget = parsePositiveInt(addTargetRaw);
    const addIncreasePpm = parsePpm(addIncreasePpmRaw);
    const addDecreasePpm = parsePpm(addDecreasePpmRaw);
    const addPricesOk =
        addInitial.trim() !== "" &&
        addFloor.trim() !== "" &&
        addTarget !== null &&
        addIncreasePpm !== null &&
        addDecreasePpm !== null;

    const trimmedLen = newLengthRaw.trim();
    const lengthTooLong =
        trimmedLen.length > 2 ||
        (/^\d+$/.test(trimmedLen) &&
            Number.parseInt(trimmedLen, 10) > MAX_PREMIUM_NAME_LENGTH);

    const duplicate =
        parsedLength !== null &&
        (rows?.some((r) => r.length === parsedLength) ?? false);

    const canAdd =
        parsedLength !== null &&
        !duplicate &&
        !isAdding &&
        addPricesOk &&
        !lengthTooLong;

    const openAddForm = () => {
        setShowAdd(true);
        setNewLengthRaw("");
        setAddInitial(PREMIUM_MARKET_DEFAULTS.initialPrice);
        setAddFloor(PREMIUM_MARKET_DEFAULTS.floorPrice);
        setAddTargetRaw(String(PREMIUM_MARKET_DEFAULTS.target));
        setAddIncreasePpmRaw(String(PREMIUM_MARKET_DEFAULTS.increasePpm));
        setAddDecreasePpmRaw(String(PREMIUM_MARKET_DEFAULTS.decreasePpm));
    };

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">
                    Premium Name Market Config
                </h2>
                <p className="text-muted-foreground text-sm">
                    Each row is a premium account name length (1–
                    {MAX_PREMIUM_NAME_LENGTH} characters). When you add a
                    market, you set the initial price; it cannot be changed
                    later. Use the switch on each row to turn purchases on or
                    off immediately. Expand a row to edit floor price, target
                    sales per 30-day window, and increase/decrease PPM (Save).
                    Saving always uses a 30-day DiffAdjust window. Disabling
                    purchases blocks new buys for that length; existing
                    purchases can still be claimed.
                </p>
            </div>

            {isError ? (
                <p className="text-destructive text-sm">
                    {error instanceof Error
                        ? error.message
                        : "Could not load premium name markets."}
                </p>
            ) : null}

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
                        disabled={bootstrapping}
                        onClick={() => bootstrapNameMarkets()}
                    >
                        {bootstrapping
                            ? "Configuring…"
                            : "Configure name markets 1–9 with defaults"}
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
                                                disabled={toggleBusy}
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
                                        />
                                    </AccordionContent>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                </div>
            ) : null}

            <div className="flex justify-end">
                <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label="Add premium market"
                    onClick={openAddForm}
                >
                    <Plus className="size-4" />
                </Button>
            </div>

            {showAdd ? (
                <div className="flex max-w-md flex-col gap-4 rounded-lg border p-4">
                    <h3 className="text-sm font-medium">Add market</h3>
                    <div className="space-y-2">
                        <Label htmlFor="new-premium-market-length">
                            Name length (1–{MAX_PREMIUM_NAME_LENGTH})
                        </Label>
                        <Input
                            id="new-premium-market-length"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={2}
                            placeholder={`1–${MAX_PREMIUM_NAME_LENGTH}`}
                            value={newLengthRaw}
                            onChange={(e) => setNewLengthRaw(e.target.value)}
                            aria-invalid={
                                trimmedLen !== "" &&
                                (parsedLength === null ||
                                    duplicate ||
                                    lengthTooLong)
                            }
                        />
                        {lengthTooLong ? (
                            <p className="text-destructive text-sm">
                                Name length must be at most{" "}
                                {MAX_PREMIUM_NAME_LENGTH}.
                            </p>
                        ) : null}
                        {duplicate ? (
                            <p className="text-destructive text-sm">
                                A market for this length already exists.
                            </p>
                        ) : null}
                        {trimmedLen !== "" &&
                        parsedLength === null &&
                        !lengthTooLong ? (
                            <p className="text-destructive text-sm">
                                Enter a whole number from 1 to{" "}
                                {MAX_PREMIUM_NAME_LENGTH}.
                            </p>
                        ) : null}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-initial">Initial price</Label>
                        <Input
                            id="add-pm-initial"
                            value={addInitial}
                            onChange={(e) => setAddInitial(e.target.value)}
                            className="font-mono"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-floor">Floor price</Label>
                        <Input
                            id="add-pm-floor"
                            value={addFloor}
                            onChange={(e) => setAddFloor(e.target.value)}
                            className="font-mono"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-target">
                            Target sales per window
                        </Label>
                        <Input
                            id="add-pm-target"
                            inputMode="numeric"
                            value={addTargetRaw}
                            onChange={(e) => setAddTargetRaw(e.target.value)}
                            className="font-mono"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-inc-ppm">Increase PPM</Label>
                        <Input
                            id="add-pm-inc-ppm"
                            inputMode="numeric"
                            value={addIncreasePpmRaw}
                            onChange={(e) =>
                                setAddIncreasePpmRaw(e.target.value)
                            }
                            autoComplete="off"
                            className="font-mono"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-dec-ppm">Decrease PPM</Label>
                        <Input
                            id="add-pm-dec-ppm"
                            inputMode="numeric"
                            value={addDecreasePpmRaw}
                            onChange={(e) =>
                                setAddDecreasePpmRaw(e.target.value)
                            }
                            autoComplete="off"
                            className="font-mono"
                        />
                    </div>
                    <p className="text-muted-foreground text-sm">
                        New markets are created with purchases enabled. You can
                        turn them off anytime using the switch on each row.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            disabled={!canAdd}
                            onClick={() => {
                                if (
                                    parsedLength === null ||
                                    addTarget === null ||
                                    addIncreasePpm === null ||
                                    addDecreasePpm === null
                                ) {
                                    return;
                                }
                                addMarket(
                                    [
                                        parsedLength,
                                        addInitial.trim(),
                                        addTarget,
                                        addFloor.trim(),
                                        addIncreasePpm,
                                        addDecreasePpm,
                                    ],
                                    {
                                        onSuccess: () => {
                                            setShowAdd(false);
                                            setNewLengthRaw("");
                                        },
                                    },
                                );
                            }}
                        >
                            {isAdding && addVars && addVars[0] === parsedLength
                                ? "Saving…"
                                : "Save"}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setShowAdd(false)}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
