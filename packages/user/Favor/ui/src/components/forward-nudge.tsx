import { useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";

import { defaultAssetId } from "@/components/asset-select";
import { useAssets } from "@/hooks/use-assets";
import { useForwardOffers } from "@/hooks/use-favor-data";
import { useSetGlobalForwardOffer } from "@/hooks/use-favor-mutations";
import { liveGlobalForward } from "@/lib/account-groups";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { toast } from "@shared/shadcn/ui/sonner";

const DISMISS_KEY = "favor.forward-nudge.dismissed";
const FOCUS_KEY = "favor.accounts.assetId";
const TOAST_ID = "favor-forward-nudge";

/**
 * Payments through you need a global path-forward. Nudge for the currency
 * the accounts page is already showing, until that one is on or the user hides it.
 */
export function ForwardNudge() {
    const { data: user } = useCurrentUser();
    const { data: assets = [] } = useAssets();
    const { data: offers, isSuccess: offersReady } = useForwardOffers();
    const setForward = useSetGlobalForwardOffer();
    const [dismissed, setDismissed] = useLocalStorage(DISMISS_KEY, false);
    const [focusedId] = useLocalStorage<number | null>(FOCUS_KEY, null);
    const lastShown = useRef<number | null>(null);

    const assetId = focusedId ?? defaultAssetId(assets);
    const symbol =
        assets.find((a) => a.id === assetId)?.symbol ?? "this currency";
    const nowSec = Math.floor(Date.now() / 1000);
    const alreadyOn =
        assetId !== undefined &&
        liveGlobalForward(offers ?? [], assetId, nowSec);
    const ready = !!user && offersReady && assetId !== undefined;

    useEffect(() => {
        if (!ready || dismissed || assetId === undefined) return;
        if (alreadyOn) {
            toast.dismiss(TOAST_ID);
            return;
        }
        if (lastShown.current === assetId) return;
        lastShown.current = assetId;

        const hide = () => {
            setDismissed(true);
            toast.dismiss(TOAST_ID);
        };
        const turnOn = () => {
            setForward.mutate(
                {
                    assetId,
                    feeFixed: "0",
                    feePercentPpm: 0,

                    expiresAtSeconds: 0,
                    allowUnknown: true,
                },
                {
                    onSuccess: () => {
                        toast.success(
                            `Forwarding is on for ${symbol}. Payments can go through you.`,
                            { id: TOAST_ID },
                        );
                    },
                },
            );
        };

        toast(`Forwarding is off for ${symbol}`, {
            id: TOAST_ID,
            description:
                "Friends cannot pay through you in this currency until it is on. Leave it on — a closed forward, no fee.",
            duration: Infinity,
            action: {
                label: "Turn it on",
                onClick: turnOn,
            },
            cancel: {
                label: "Don't show again",
                onClick: hide,
            },
        });
    }, [ready, dismissed, alreadyOn, assetId, symbol, setDismissed, setForward]);

    return null;
}
