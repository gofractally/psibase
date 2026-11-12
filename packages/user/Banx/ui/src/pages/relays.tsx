import { useRef, useState } from "react";

import { useStore } from "@tanstack/react-form";
import { Plus } from "lucide-react";

import { AssetField } from "@/components/form-fields";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useBanxRelays,
    useTokenPrecisionMap,
    useTokenRelays,
} from "@/hooks/use-banx-data";
import {
    useRemoveRelay,
    useRemoveTokenRelay,
    useSetRelay,
    useSetTokenRelay,
} from "@/hooks/use-banx-mutations";
import { amountPlaceholder, displayAmount } from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    amountFieldValidator,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { Asset, BanxRelay, TokenRelay } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

function parseTokenId(raw: string): number | undefined {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n <= 0) return undefined;
    return n;
}

function poolKey(owner: string, lo: number, hi: number): string {
    return `${owner}:${lo}:${hi}`;
}

/** Price of one unit of each weight in the other. Both weights are one market value. */
function poolUnitPrices(
    reserveA: string,
    reserveB: string,
): { aInB: string; bInA: string } | null {
    const a = Number(reserveA);
    const b = Number(reserveB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        return null;
    }
    return { aInB: (b / a).toFixed(4), bInA: (a / b).toFixed(4) };
}

function IouPoolForm({
    assets,
    symbolOf,
    precisionOf,
    onPosted,
}: {
    assets: Asset[];
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
    onPosted: () => void;
}) {
    const setRelay = useSetRelay();
    const form = useAppForm({
        defaultValues: {
            assetA: undefined as number | undefined,
            assetB: undefined as number | undefined,
            reserveA: "",
            reserveB: "",
            feePct: "0",
        },
        onSubmit: async ({ value }) => {
            if (
                value.assetA === undefined ||
                value.assetB === undefined ||
                value.assetA === value.assetB ||
                !value.reserveA.trim() ||
                !value.reserveB.trim()
            ) {
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setRelay.mutate(
                    {
                        assetA: value.assetA!,
                        assetB: value.assetB!,
                        reserveA: value.reserveA.trim(),
                        reserveB: value.reserveB.trim(),
                        feePpm: percentStringToPpm(
                            value.feePct,
                            MAX_HOP_FEE_PPM,
                        ),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
            onPosted();
        },
    });

    return (
        <form
            className="grid gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
            }}
        >
            <form.Subscribe
                selector={(s) => s.values}
                children={(values) => {
                    const precA =
                        values.assetA !== undefined
                            ? precisionOf(values.assetA)
                            : 0;
                    const precB =
                        values.assetB !== undefined
                            ? precisionOf(values.assetB)
                            : 0;
                    return (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <form.Field
                                    name="assetA"
                                    children={(field) => (
                                        <AssetField
                                            label="Asset A"
                                            assets={assets}
                                            value={field.state.value}
                                            onChange={(id) =>
                                                field.handleChange(id)
                                            }
                                        />
                                    )}
                                />
                                <form.Field
                                    name="assetB"
                                    children={(field) => (
                                        <AssetField
                                            label="Asset B"
                                            assets={assets}
                                            value={field.state.value}
                                            onChange={(id) =>
                                                field.handleChange(id)
                                            }
                                        />
                                    )}
                                />
                            </div>
                            {values.assetA !== undefined &&
                            values.assetA === values.assetB ? (
                                <p className="text-sm text-destructive">
                                    Pick two different assets.
                                </p>
                            ) : null}
                            <div className="grid gap-4 sm:grid-cols-2">
                                <form.AppField
                                    name="reserveA"
                                    validators={{
                                        onChange: amountFieldValidator(precA, {
                                            allowZero: false,
                                        }),
                                        onSubmit: amountFieldValidator(precA, {
                                            allowZero: false,
                                        }),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Reserve A"
                                            inputMode="decimal"
                                            placeholder={amountPlaceholder(
                                                precA,
                                            )}
                                            required
                                        />
                                    )}
                                />
                                <form.AppField
                                    name="reserveB"
                                    validators={{
                                        onChange: amountFieldValidator(precB, {
                                            allowZero: false,
                                        }),
                                        onSubmit: amountFieldValidator(precB, {
                                            allowZero: false,
                                        }),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Reserve B"
                                            inputMode="decimal"
                                            placeholder={amountPlaceholder(
                                                precB,
                                            )}
                                            required
                                        />
                                    )}
                                />
                            </div>
                            {values.assetA !== undefined &&
                            values.assetB !== undefined &&
                            values.assetA !== values.assetB
                                ? (() => {
                                      const prices = poolUnitPrices(
                                          values.reserveA,
                                          values.reserveB,
                                      );
                                      if (!prices) return null;
                                      const symA = symbolOf(
                                          values.assetA,
                                      ).toUpperCase();
                                      const symB = symbolOf(
                                          values.assetB,
                                      ).toUpperCase();
                                      return (
                                          <div className="text-muted-foreground space-y-2 text-sm">
                                              <div className="flex justify-between gap-4">
                                                  <span>{symA} price</span>
                                                  <span>
                                                      {prices.aInB} {symB}
                                                  </span>
                                              </div>
                                              <div className="flex justify-between gap-4">
                                                  <span>{symB} price</span>
                                                  <span>
                                                      {prices.bInA} {symA}
                                                  </span>
                                              </div>
                                          </div>
                                      );
                                  })()
                                : null}
                            <form.AppField
                                name="feePct"
                                validators={{
                                    onChange: percentFieldValidator(
                                        MAX_HOP_FEE_PERCENT,
                                    ),
                                    onSubmit: percentFieldValidator(
                                        MAX_HOP_FEE_PERCENT,
                                    ),
                                }}
                                children={(field) => (
                                    <field.TextField
                                        label="Fee %"
                                        inputMode="decimal"
                                        description="Taken from the input before the curve. Under 100%."
                                        required
                                    />
                                )}
                            />
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Post pool", "Posting…"]}
                                    loading={setRelay.isPending}
                                    disabled={
                                        values.assetA === undefined ||
                                        values.assetB === undefined ||
                                        values.assetA === values.assetB ||
                                        !values.reserveA.trim() ||
                                        !values.reserveB.trim()
                                    }
                                />
                            </form.AppForm>
                        </>
                    );
                }}
            />
        </form>
    );
}

function TokenPoolForm({
    assets,
    precisionOf,
    onPosted,
}: {
    assets: Asset[];
    precisionOf: (id: number) => number;
    onPosted: () => void;
}) {
    const setRelay = useSetTokenRelay();
    // useAppForm keeps the first onSubmit. The ref is current when precision arrives.
    const tokenState = useRef({
        tokenId: undefined as number | undefined,
        precision: undefined as number | undefined,
        pending: false,
        failed: false,
    });
    const form = useAppForm({
        defaultValues: {
            assetId: undefined as number | undefined,
            tokenId: "",
            reserveBanx: "",
            reserveTokens: "",
            feePct: "0",
        },
        onSubmit: async ({ value }) => {
            const tokenId = parseTokenId(value.tokenId);
            const state = tokenState.current;
            if (
                value.assetId === undefined ||
                tokenId === undefined ||
                state.precision === undefined ||
                !value.reserveBanx.trim() ||
                !value.reserveTokens.trim()
            ) {
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setRelay.mutate(
                    {
                        assetId: value.assetId!,
                        tokenId,
                        reserveBanx: value.reserveBanx.trim(),
                        reserveTokens: value.reserveTokens.trim(),
                        feePpm: percentStringToPpm(
                            value.feePct,
                            MAX_HOP_FEE_PPM,
                        ),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
            onPosted();
        },
    });
    const tokenIdRaw = useStore(form.store, (s) => s.values.tokenId);
    const reserveTokensRaw = useStore(form.store, (s) => s.values.reserveTokens);
    const tokenId = parseTokenId(tokenIdRaw);
    const {
        precision: tokenPrecisions,
        pending: tokenPending,
        failed: tokenFailed,
    } = useTokenPrecisionMap(tokenId === undefined ? [] : [tokenId]);
    const tokenPrecision =
        tokenId === undefined ? undefined : tokenPrecisions.get(tokenId);
    tokenState.current = {
        tokenId,
        precision: tokenPrecision,
        pending: tokenId !== undefined && tokenPending.has(tokenId),
        failed: tokenId !== undefined && tokenFailed.has(tokenId),
    };
    const tokenReserveError = ({
        value,
    }: {
        value: string;
    }): string | undefined => {
        const state = tokenState.current;
        if (state.tokenId === undefined) return undefined;
        if (state.precision === undefined) {
            return state.failed
                ? `Couldn't load precision for token #${state.tokenId}.`
                : `Token #${state.tokenId} precision is still loading.`;
        }
        return amountFieldValidator(state.precision, { allowZero: false })({
            value,
        });
    };

    return (
        <form
            className="grid gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
            }}
        >
            <form.Subscribe
                selector={(s) => s.values}
                children={(values) => {
                    const prec =
                        values.assetId !== undefined
                            ? precisionOf(values.assetId)
                            : 0;
                    const reserveBlocked =
                        tokenId !== undefined &&
                        (tokenPrecision === undefined ||
                            amountFieldValidator(tokenPrecision, {
                                allowZero: false,
                            })({ value: reserveTokensRaw }) !== undefined);
                    return (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <form.Field
                                    name="assetId"
                                    children={(field) => (
                                        <AssetField
                                            label="IOU"
                                            assets={assets}
                                            value={field.state.value}
                                            onChange={(id) =>
                                                field.handleChange(id)
                                            }
                                        />
                                    )}
                                />
                                <form.AppField
                                    name="tokenId"
                                    validators={{
                                        onSubmit: ({ value }) =>
                                            parseTokenId(value) === undefined
                                                ? "Enter a token id"
                                                : undefined,
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Token id"
                                            inputMode="numeric"
                                            required
                                        />
                                    )}
                                />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <form.AppField
                                    name="reserveBanx"
                                    validators={{
                                        onChange: amountFieldValidator(prec, {
                                            allowZero: false,
                                        }),
                                        onSubmit: amountFieldValidator(prec, {
                                            allowZero: false,
                                        }),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="IOU reserve"
                                            inputMode="decimal"
                                            placeholder={amountPlaceholder(
                                                prec,
                                            )}
                                            required
                                        />
                                    )}
                                />
                                <form.AppField
                                    name="reserveTokens"
                                    validators={{
                                        onChange: tokenReserveError,
                                        onSubmit: tokenReserveError,
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Token reserve"
                                            inputMode="decimal"
                                            placeholder={
                                                tokenPrecision === undefined
                                                    ? ""
                                                    : amountPlaceholder(
                                                          tokenPrecision,
                                                      )
                                            }
                                            description="Deposited into this pool. The same pair cannot be posted twice."
                                            required
                                        />
                                    )}
                                />
                            </div>
                            <form.AppField
                                name="feePct"
                                validators={{
                                    onChange: percentFieldValidator(
                                        MAX_HOP_FEE_PERCENT,
                                    ),
                                    onSubmit: percentFieldValidator(
                                        MAX_HOP_FEE_PERCENT,
                                    ),
                                }}
                                children={(field) => (
                                    <field.TextField
                                        label="Fee %"
                                        inputMode="decimal"
                                        description="Taken from the input before the curve. Under 100%."
                                        required
                                    />
                                )}
                            />
                            {tokenId !== undefined &&
                            tokenPrecision === undefined ? (
                                <p
                                    className="text-sm text-destructive"
                                    role="status"
                                >
                                    {tokenFailed.has(tokenId)
                                        ? `Couldn't load precision for token #${tokenId}.`
                                        : `Token #${tokenId} precision is still loading.`}
                                </p>
                            ) : null}
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Post pool", "Posting…"]}
                                    loading={setRelay.isPending}
                                    disabled={
                                        values.assetId === undefined ||
                                        tokenId === undefined ||
                                        !values.reserveBanx.trim() ||
                                        !values.reserveTokens.trim() ||
                                        reserveBlocked
                                    }
                                />
                            </form.AppForm>
                        </>
                    );
                }}
            />
        </form>
    );
}

function IouPools({
    mine,
    loading,
    symbolOf,
}: {
    mine: BanxRelay[];
    loading: boolean;
    symbolOf: (id: number) => string;
}) {
    const removeRelay = useRemoveRelay();
    return (
        <section className="grid gap-3">
            <h2 className="font-medium">IOU pools</h2>
            {loading ? (
                <p className="text-muted-foreground text-sm">Loading pools…</p>
            ) : mine.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    You have not posted an IOU pool.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Pair</TableHead>
                                <TableHead className="text-right">
                                    Reserves
                                </TableHead>
                                <TableHead className="text-right">
                                    Fee
                                </TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mine.map((row) => (
                                <TableRow
                                    key={poolKey(
                                        row.owner,
                                        row.assetLo,
                                        row.assetHi,
                                    )}
                                >
                                    <TableCell>
                                        {symbolOf(row.assetLo)} /{" "}
                                        {symbolOf(row.assetHi)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {displayAmount(row.reserveLo)} /{" "}
                                        {displayAmount(row.reserveHi)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {ppmToPercent(row.feePpm)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={removeRelay.isPending}
                                            onClick={() =>
                                                removeRelay.mutate({
                                                    assetA: row.assetLo,
                                                    assetB: row.assetHi,
                                                })
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            <p className="text-muted-foreground text-xs">
                Removing a pool leaves claims already drawn.
            </p>
        </section>
    );
}

function TokenPools({
    mine,
    loading,
    symbolOf,
}: {
    mine: TokenRelay[];
    loading: boolean;
    symbolOf: (id: number) => string;
}) {
    const removeRelay = useRemoveTokenRelay();
    return (
        <section className="grid gap-3">
            <h2 className="font-medium">Token pools</h2>
            {loading ? (
                <p className="text-muted-foreground text-sm">Loading pools…</p>
            ) : mine.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    You have not posted a token pool.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Sells</TableHead>
                                <TableHead className="text-right">
                                    IOU weight
                                </TableHead>
                                <TableHead className="text-right">
                                    Token reserve
                                </TableHead>
                                <TableHead className="text-right">
                                    Fee
                                </TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mine.map((row) => (
                                <TableRow key={`${row.assetId}:${row.tokenId}`}>
                                    <TableCell>
                                        {symbolOf(row.assetId)} → #
                                        {row.tokenId}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {displayAmount(row.reserveBanx)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {displayAmount(row.tokenReserve)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {ppmToPercent(row.feePpm)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={removeRelay.isPending}
                                            onClick={() =>
                                                removeRelay.mutate({
                                                    assetId: row.assetId,
                                                    tokenId: row.tokenId,
                                                })
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            <p className="text-muted-foreground text-xs">
                Removing a token pool returns the tokens still in it. Claims
                already drawn stay.
            </p>
        </section>
    );
}

export function RelaysPage() {
    const { data: user } = useCurrentUser();
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const {
        data: relays = [],
        isLoading: relaysLoading,
        isError: relaysError,
    } = useBanxRelays();
    const {
        data: tokenRelays = [],
        isLoading: tokenLoading,
        isError: tokenError,
    } = useTokenRelays();
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<"iou" | "token">("iou");
    const mine = relays.filter((row) => row.owner === user);
    const myTokens = tokenRelays.filter((row) => row.owner === user);

    return (
        <div className="space-y-10">
            <PageHeader
                title="Pools"
                description="Constant-product pools you have posted."
                action={
                    <Button
                        type="button"
                        size="icon"
                        className="size-11 shrink-0 rounded-full bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 sm:size-9"
                        aria-label="Post a pool"
                        onClick={() => {
                            setKind("iou");
                            setOpen(true);
                        }}
                    >
                        <Plus className="size-5" />
                    </Button>
                }
            />
            {relaysError || tokenError ? (
                <p className="text-sm text-destructive" role="alert">
                    Couldn't load pools.
                </p>
            ) : null}
            <IouPools
                mine={mine}
                loading={relaysLoading}
                symbolOf={symbolOf}
            />
            <TokenPools
                mine={myTokens}
                loading={tokenLoading}
                symbolOf={symbolOf}
            />
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col overflow-y-auto sm:max-w-xl">
                    <DialogHeader className="pr-8">
                        <DialogTitle>Post a pool</DialogTitle>
                        {kind === "iou" ? (
                            <DialogDescription>
                                Both reserves are virtual weights of equal
                                market value. Posting them creates no claim. A
                                fill leaves you owed the input by the previous
                                hop and owing the next hop only the curve
                                output. Posting again replaces the weights. One
                                pool per pair.
                            </DialogDescription>
                        ) : (
                            <DialogDescription>
                                The IOU reserve is a virtual weight. You deposit
                                the token reserve into this pool. The same pair
                                cannot be posted twice. Removing the pool
                                returns the tokens still in it.
                            </DialogDescription>
                        )}
                    </DialogHeader>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant={kind === "iou" ? "default" : "outline"}
                            aria-pressed={kind === "iou"}
                            onClick={() => setKind("iou")}
                        >
                            IOU
                        </Button>
                        <Button
                            type="button"
                            variant={kind === "token" ? "default" : "outline"}
                            aria-pressed={kind === "token"}
                            onClick={() => setKind("token")}
                        >
                            Token
                        </Button>
                    </div>
                    {kind === "iou" ? (
                        <IouPoolForm
                            assets={assets}
                            symbolOf={symbolOf}
                            precisionOf={precisionOf}
                            onPosted={() => setOpen(false)}
                        />
                    ) : (
                        <TokenPoolForm
                            assets={assets}
                            precisionOf={precisionOf}
                            onPosted={() => setOpen(false)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
