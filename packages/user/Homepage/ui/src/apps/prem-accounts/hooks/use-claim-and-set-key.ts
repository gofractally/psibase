import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { homepage } from "@shared/lib/plugins";

/**
 * Claims a purchased premium account name, configures auth-sig on it, and
 * returns the new account's private key (PEM format).
 */
export const useClaimAndSetKey = () => {
    return usePluginFunctionMutation(homepage.premiumAccounts.claimAndSetKey, {
        toast: {
            loading: "Claiming account...",
            error: "Failed to claim account",
            success: "Account claimed",
        },
    });
};
