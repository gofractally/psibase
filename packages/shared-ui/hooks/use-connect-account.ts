import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { AutoRedirectConfig } from "@psibase/common-lib";

import { switchAccountUrl } from "@shared/components/account-menu/links";

export const useConnectAccount = (
    options: UseMutationOptions<void, Error, AutoRedirectConfig | void> = {},
) =>
    useMutation({
        mutationFn: async (autoRedirectConfig?) => {
            // Straight to the sign-in app, with this app and the page to
            // come back to in the address. Going through a prompt recorded
            // in browser storage first added a hop that Safari could not
            // follow, and carried nothing the address cannot.
            window.location.assign(
                switchAccountUrl(autoRedirectConfig?.returnPath ?? undefined),
            );
            // The page is leaving; nothing runs after this.
            await new Promise<void>(() => {});
        },
        ...options,
    });
