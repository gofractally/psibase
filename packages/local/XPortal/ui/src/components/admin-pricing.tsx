import type { PricingBasis, PricingPatch } from "../lib/admin-api";

import { useMutation } from "@tanstack/react-query";
import { CircleHelp, Link2, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { errorText, formatUnits } from "../lib/portal-api";
import {
    type Draft,
    type SavedPricing,
    type TierDraft,
    draftOf,
    formatBufferMultiple,
    linkedPrice,
    parsePriceMicros,
    parseUsdCents,
    patchOf,
    priceForMarketCap,
    pricingPatchesEqual,
    tierTokens,
} from "../lib/pricing";
import { AdminSection } from "./admin-section";

const HelpHint = ({ label, text }: { label: string; text: string }) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <button
                type="button"
                aria-label={label}
                className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded-full"
            >
                <CircleHelp className="size-3.5" />
            </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64">
            {text}
        </TooltipContent>
    </Tooltip>
);

const ColumnLabel = ({ children }: { children: React.ReactNode }) => (
    <span className="text-muted-foreground text-xs">{children}</span>
);

/** Shows `before → after` beneath `after` while they differ. */
const GrantFigure = ({
    before,
    after,
    className,
}: {
    before?: string;
    after?: string;
    className?: string;
}) => (
    <div className="space-y-1">
        <p className={cn("text-sm tabular-nums", className)}>{after ?? "—"}</p>
        {after !== undefined && before !== after && (
            <p className="text-muted-foreground text-xs tabular-nums">
                {before} →{" "}
                <span className="text-foreground font-medium">{after}</span>
            </p>
        )}
    </div>
);

/** `tokens` at the draft price, and `before` at the saved one. */
type Grant = { before: bigint; tokens: bigint };

const TierRow = ({
    name,
    usd,
    usdLabel,
    usdHint,
    usdDisabled,
    onUsdChange,
    grant,
    basis,
    remove,
    className,
}: {
    name: React.ReactNode;
    usd: string;
    usdLabel: string;
    usdHint?: React.ReactNode;
    usdDisabled?: boolean;
    onUsdChange: (usd: string) => void;
    grant: Grant | null;
    basis: PricingBasis;
    remove?: React.ReactNode;
    className?: string;
}) => {
    const usdId = useId();
    const units = (tokens: bigint) =>
        formatUnits(String(tokens), basis.precision);
    return (
        <li
            className={cn(
                "grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(4.5rem,5.5rem)_2.5rem] sm:gap-x-3 sm:gap-y-1",
                className,
            )}
        >
            <div className="flex min-w-0 items-center sm:pt-[1.625rem]">
                {name}
            </div>
            <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1">
                    <Label
                        htmlFor={usdId}
                        className="text-muted-foreground text-xs font-normal"
                    >
                        USD price
                    </Label>
                    {usdHint}
                </div>
                <Input
                    id={usdId}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={usdLabel}
                    aria-invalid={!parseUsdCents(usd)}
                    disabled={usdDisabled}
                    value={usd}
                    onChange={(event) => onUsdChange(event.target.value)}
                />
            </div>
            <div className="min-w-0 space-y-1">
                <ColumnLabel>Tokens</ColumnLabel>
                <GrantFigure
                    className="font-mono"
                    before={grant ? units(grant.before) : undefined}
                    after={grant ? units(grant.tokens) : undefined}
                />
            </div>
            <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1">
                    <ColumnLabel>× buffer</ColumnLabel>
                    <HelpHint
                        label="Buffer multiple"
                        text="Resources granted, in multiples of the standard account buffer."
                    />
                </div>
                <GrantFigure
                    before={
                        grant
                            ? formatBufferMultiple(grant.before, basis)
                            : undefined
                    }
                    after={
                        grant
                            ? formatBufferMultiple(grant.tokens, basis)
                            : undefined
                    }
                />
            </div>
            <div className="flex justify-end sm:justify-center sm:pt-[1.375rem]">
                {remove}
            </div>
        </li>
    );
};

/**
 * Price per token and network market cap are two views of one stored price.
 * Repricing holds each tier's USD price and previews its new grant.
 */
export const PricingSection = ({
    saved,
    onSave,
}: {
    saved: SavedPricing;
    onSave: (patch: PricingPatch) => Promise<void>;
}) => {
    const [edited, setEdited] = useState<Draft | null>(null);
    const save = useMutation({
        mutationFn: onSave,
        onSuccess: () => setEdited(null),
    });
    const { basis } = saved;
    const draft = edited ?? draftOf(saved);
    const patch = patchOf(draft);
    const dirty = !patch || !pricingPatchesEqual(patch, saved.patch);
    const savedMicros = BigInt(saved.patch.price_per_token_usd_micros);

    const edit = (change: Partial<Draft>) => setEdited({ ...draft, ...change });
    const setPrice = (price: string) => {
        const micros = parsePriceMicros(price);
        edit(
            micros
                ? { ...linkedPrice(micros, basis), price }
                : { price, micros: null },
        );
    };
    const setMarketCap = (marketCap: string) => {
        const micros = priceForMarketCap(marketCap, basis);
        edit(
            micros
                ? { ...linkedPrice(micros, basis), marketCap }
                : { marketCap, micros },
        );
    };
    const settlePrice = () => {
        if (edited?.micros) edit(linkedPrice(edited.micros, basis));
    };
    const setTier = (key: number, change: Partial<TierDraft>) =>
        edit({
            tiers: draft.tiers.map((tier) =>
                tier.key === key ? { ...tier, ...change } : tier,
            ),
        });
    const addTier = () =>
        edit({
            tiers: [
                ...draft.tiers,
                {
                    key: Math.max(-1, ...draft.tiers.map((t) => t.key)) + 1,
                    label: "",
                    usd: "",
                },
            ],
        });
    const removeTier = (key: number) =>
        edit({ tiers: draft.tiers.filter((tier) => tier.key !== key) });

    const grantFor = (usd: string): Grant | null => {
        const cents = parseUsdCents(usd);
        if (!cents || !draft.micros) return null;
        return {
            before: tierTokens(cents, savedMicros, basis),
            tokens: tierTokens(cents, draft.micros, basis),
        };
    };

    const problem = save.error
        ? errorText(save.error)
        : patch
          ? null
          : !draft.freeEnabled && draft.tiers.length === 0
            ? "Turn on the free tier or add a paid tier."
            : "Fix the highlighted fields.";

    return (
        <AdminSection
            title="Pricing"
            action={
                dirty && (
                    <span className="text-sm font-medium text-amber-500">
                        Unsaved changes
                    </span>
                )
            }
        >
            <form
                className="flex flex-col gap-6 rounded-lg border px-4 py-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (patch) save.mutate(patch);
                }}
            >
                <div className="rounded-lg border px-3 py-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-1 sm:gap-x-2">
                        <div className="min-w-0 space-y-1.5">
                            <Label
                                htmlFor="price-per-token"
                                className="text-xs"
                            >
                                Price per token (USD)
                            </Label>
                            <Input
                                id="price-per-token"
                                inputMode="decimal"
                                autoComplete="off"
                                className="font-mono tabular-nums"
                                aria-invalid={!draft.micros}
                                value={draft.price}
                                onChange={(event) =>
                                    setPrice(event.target.value)
                                }
                                onBlur={settlePrice}
                            />
                        </div>
                        <Link2
                            aria-hidden
                            className="text-muted-foreground mb-2.5 size-4"
                        />
                        <div className="min-w-0 space-y-1.5">
                            <Label
                                htmlFor="network-market-cap"
                                className="text-xs"
                            >
                                Network market cap (USD)
                            </Label>
                            <Input
                                id="network-market-cap"
                                inputMode="decimal"
                                autoComplete="off"
                                className="tabular-nums"
                                aria-invalid={!draft.micros}
                                value={draft.marketCap}
                                onChange={(event) =>
                                    setMarketCap(event.target.value)
                                }
                                onBlur={settlePrice}
                            />
                        </div>
                    </div>
                    <p className="text-muted-foreground mt-2 text-xs tabular-nums">
                        × {formatUnits(basis.supply.value, basis.precision)}{" "}
                        supply
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">Tiers</p>
                    <ul className="divide-y rounded-lg border">
                        <TierRow
                            className={
                                draft.freeEnabled
                                    ? undefined
                                    : "bg-muted/30 opacity-70"
                            }
                            name={
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="free-tier"
                                        checked={draft.freeEnabled}
                                        onCheckedChange={(freeEnabled) =>
                                            edit({ freeEnabled })
                                        }
                                    />
                                    <Label
                                        htmlFor="free-tier"
                                        className="text-sm font-medium"
                                    >
                                        Free
                                    </Label>
                                </div>
                            }
                            usd={draft.freeUsd}
                            usdLabel="Free tier USD price"
                            usdHint={
                                <HelpHint
                                    label="Free tier USD price"
                                    text="Visitors pay nothing. This value only sets how many tokens a free account gets."
                                />
                            }
                            usdDisabled={!draft.freeEnabled}
                            onUsdChange={(freeUsd) => edit({ freeUsd })}
                            grant={grantFor(draft.freeUsd)}
                            basis={basis}
                        />
                        {draft.tiers.map((tier) => (
                            <TierRow
                                key={tier.key}
                                name={
                                    <Input
                                        aria-label="Tier label"
                                        autoComplete="off"
                                        placeholder="Label"
                                        className="h-8 font-medium"
                                        aria-invalid={!tier.label.trim()}
                                        value={tier.label}
                                        onChange={(event) =>
                                            setTier(tier.key, {
                                                label: event.target.value,
                                            })
                                        }
                                    />
                                }
                                usd={tier.usd}
                                usdLabel={`${tier.label || "New"} tier USD price`}
                                onUsdChange={(usd) =>
                                    setTier(tier.key, { usd })
                                }
                                grant={grantFor(tier.usd)}
                                basis={basis}
                                remove={
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-sm"
                                        className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        aria-label={`Delete ${tier.label || "new"} tier`}
                                        onClick={() => removeTier(tier.key)}
                                    >
                                        <Trash2 />
                                    </Button>
                                }
                            />
                        ))}
                    </ul>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto sm:self-start"
                        onClick={addTier}
                    >
                        <Plus />
                        Add tier
                    </Button>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {problem && (
                        <p className="text-destructive text-sm">{problem}</p>
                    )}
                    <Button
                        type="submit"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={!dirty || !patch || save.isPending}
                    >
                        {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
                    </Button>
                </div>
            </form>
        </AdminSection>
    );
};
