import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export const ACCOUNT_TABS = ["profile", "credits", "preferences"] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

const PARAM = "account";

/**
 * The account drawer's open tab lives in the URL so any page (or another
 * app) can deep-link to it without leaving what the user was doing.
 */
export const useAccountSheet = () => {
    const [params, setParams] = useSearchParams();
    const raw = params.get(PARAM);
    const tab = (ACCOUNT_TABS as readonly string[]).includes(raw ?? "")
        ? (raw as AccountTab)
        : null;

    const setTab = useCallback(
        (next: AccountTab | null, replace = false) =>
            setParams(
                (prev) => {
                    const p = new URLSearchParams(prev);
                    if (next) p.set(PARAM, next);
                    else p.delete(PARAM);
                    return p;
                },
                { replace },
            ),
        [setParams],
    );

    return {
        tab,
        open: useCallback(
            (next: AccountTab = "profile") => setTab(next),
            [setTab],
        ),
        switchTo: useCallback(
            (next: AccountTab) => setTab(next, true),
            [setTab],
        ),
        close: useCallback(() => setTab(null), [setTab]),
    };
};
