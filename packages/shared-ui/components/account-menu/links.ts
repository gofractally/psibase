import { siblingUrl } from "@psibase/common-lib";

/** The app this page belongs to, as its host names it. */
const thisApp = () => window.location.hostname.split(".")[0];

const here = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

/**
 * A page of the network's sign-in app, which is where accounts are chosen
 * and their keys are managed. It returns the visitor to `path` in this app.
 */
const signInUrl = (params: Record<string, string>, path = here()) =>
    siblingUrl(
        null,
        "supervisor",
        `/sign-in.html?${new URLSearchParams({ ...params, app: thisApp(), path })}`,
    );

/** Accounts on this browser, their keys, recovery and security. */
export const accountsAndKeysUrl = () => signInUrl({ step: "manage" });

/**
 * Choose which account this app sees, or create one for it. This is also
 * where a visitor signs in; `path` is where they return to in this app.
 */
export const switchAccountUrl = (path?: string) =>
    signInUrl({ step: "account" }, path);

/** Leave this app's account and stay as a guest. */
export const logOutUrl = () => signInUrl({ step: "account", intent: "guest" }, "/");

/** The profile editor, which lives in the home app. */
export const profileUrl = () => siblingUrl(null, "homepage", "/?account=profile");
