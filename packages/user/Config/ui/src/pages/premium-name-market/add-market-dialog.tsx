import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";
import type { UseMutateFunction } from "@tanstack/react-query";

import { useEffect, useMemo, useState } from "react";

import { PREMIUM_MARKET_DEFAULT_PARAMS } from "@/lib/premium-name-market-defaults";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { parseAccountNameLength, parsePct, parsePositiveInt } from "./parsers";

type AddMarketParams = [number, string, number, string, number, number];

export type AddMarketDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rows: ConfiguredPremiumNameMarketRow[] | undefined;
    actionsDisabled: boolean;
    allLengthMarketsCreated: boolean;
    addMarket: UseMutateFunction<unknown, Error, AddMarketParams, unknown>;
    isAdding: boolean;
    addVars: AddMarketParams | undefined;
};

export function AddMarketDialog({
    open,
    onOpenChange,
    rows,
    actionsDisabled,
    allLengthMarketsCreated,
    addMarket,
    isAdding,
    addVars,
}: AddMarketDialogProps) {
    const [newLengthRaw, setNewLengthRaw] = useState("");
    const [addInitial, setAddInitial] = useState<string>(
        PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice,
    );
    const [addFloor, setAddFloor] = useState<string>(
        PREMIUM_MARKET_DEFAULT_PARAMS.floorPrice,
    );
    const [addTargetRaw, setAddTargetRaw] = useState(
        String(PREMIUM_MARKET_DEFAULT_PARAMS.target),
    );
    const [addIncreasePctRaw, setAddIncreasePctRaw] = useState(
        String(PREMIUM_MARKET_DEFAULT_PARAMS.increasePct),
    );
    const [addDecreasePctRaw, setAddDecreasePctRaw] = useState(
        String(PREMIUM_MARKET_DEFAULT_PARAMS.decreasePct),
    );

    useEffect(() => {
        if (!open) return;
        setNewLengthRaw("");
        setAddInitial(PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice);
        setAddFloor(PREMIUM_MARKET_DEFAULT_PARAMS.floorPrice);
        setAddTargetRaw(String(PREMIUM_MARKET_DEFAULT_PARAMS.target));
        setAddIncreasePctRaw(String(PREMIUM_MARKET_DEFAULT_PARAMS.increasePct));
        setAddDecreasePctRaw(String(PREMIUM_MARKET_DEFAULT_PARAMS.decreasePct));
    }, [open]);

    const parsedLength = useMemo(
        () => parseAccountNameLength(newLengthRaw),
        [newLengthRaw],
    );

    const addTarget = parsePositiveInt(addTargetRaw);
    const addIncreasePct = parsePct(addIncreasePctRaw);
    const addDecreasePct = parsePct(addDecreasePctRaw);
    const addPricesOk =
        addInitial.trim() !== "" &&
        addFloor.trim() !== "" &&
        addTarget !== null &&
        addIncreasePct !== null &&
        addDecreasePct !== null;

    const trimmedLen = newLengthRaw.trim();
    const lengthTooLong =
        trimmedLen.length > 2 ||
        (/^\d+$/.test(trimmedLen) &&
            Number.parseInt(trimmedLen, 10) > MAX_ACCOUNT_NAME_LENGTH);

    const duplicate =
        parsedLength !== null &&
        (rows?.some((r) => r.length === parsedLength) ?? false);

    const canAdd =
        !actionsDisabled &&
        !allLengthMarketsCreated &&
        parsedLength !== null &&
        !duplicate &&
        !isAdding &&
        addPricesOk &&
        !lengthTooLong;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add market</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="new-premium-market-length">
                            Name length ({MIN_ACCOUNT_NAME_LENGTH}–
                            {MAX_ACCOUNT_NAME_LENGTH})
                        </Label>
                        <Input
                            id="new-premium-market-length"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={2}
                            placeholder={`${MIN_ACCOUNT_NAME_LENGTH}-${MAX_ACCOUNT_NAME_LENGTH}`}
                            value={newLengthRaw}
                            onChange={(e) => setNewLengthRaw(e.target.value)}
                            disabled={actionsDisabled}
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
                                {MAX_ACCOUNT_NAME_LENGTH}.
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
                                Enter a whole number from{" "}
                                {MIN_ACCOUNT_NAME_LENGTH} to{" "}
                                {MAX_ACCOUNT_NAME_LENGTH}.
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
                            disabled={actionsDisabled}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-floor">Floor price</Label>
                        <Input
                            id="add-pm-floor"
                            value={addFloor}
                            onChange={(e) => setAddFloor(e.target.value)}
                            className="font-mono"
                            disabled={actionsDisabled}
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
                            disabled={actionsDisabled}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-inc-pct">Increase percent</Label>
                        <Input
                            id="add-pm-inc-pct"
                            inputMode="numeric"
                            value={addIncreasePctRaw}
                            onChange={(e) =>
                                setAddIncreasePctRaw(e.target.value)
                            }
                            autoComplete="off"
                            className="font-mono"
                            disabled={actionsDisabled}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="add-pm-dec-pct">Decrease percent</Label>
                        <Input
                            id="add-pm-dec-pct"
                            inputMode="numeric"
                            value={addDecreasePctRaw}
                            onChange={(e) =>
                                setAddDecreasePctRaw(e.target.value)
                            }
                            autoComplete="off"
                            className="font-mono"
                            disabled={actionsDisabled}
                        />
                    </div>
                    <p className="text-muted-foreground text-sm">
                        New markets are created with purchases enabled. You can
                        turn them off anytime using the switch on each row.
                    </p>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        disabled={!canAdd}
                        onClick={() => {
                            if (
                                parsedLength === null ||
                                addTarget === null ||
                                addIncreasePct === null ||
                                addDecreasePct === null
                            ) {
                                return;
                            }
                            addMarket(
                                [
                                    parsedLength,
                                    addInitial.trim(),
                                    addTarget,
                                    addFloor.trim(),
                                    addIncreasePct,
                                    addDecreasePct,
                                ],
                                {
                                    onSuccess: () => {
                                        onOpenChange(false);
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
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
