import type { QueryClient } from "@tanstack/react-query";

import { useMutation } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { callPluginFunction, homepage } from "@shared/lib/plugins";
import { TOKEN_ICON_OPTIONS, prepareImage } from "@shared/lib/prepare-image";
import { toast } from "@shared/shadcn/ui/sonner";

const refreshIcons = (client: QueryClient, user: string | null) => {
    client.invalidateQueries({ queryKey: QueryKey.userTokenBalances(user) });
    client.invalidateQueries({ queryKey: ["token"] });
    client.invalidateQueries({ queryKey: ["pools"] });
};

const successMessage = (action: string, proposeAs: string | undefined) =>
    proposeAs
        ? `Proposed token icon ${action} on behalf of ${proposeAs}`
        : `Token icon ${action}`;

export const useSetTokenIcon = (user: string | null) =>
    useMutation<
        void,
        Error,
        { tokenId: number; file: File; proposeAs?: string }
    >({
        mutationKey: ["setTokenIcon"],
        mutationFn: async ({ tokenId, file, proposeAs }) => {
            const icon = await prepareImage(file, TOKEN_ICON_OPTIONS);
            await callPluginFunction(homepage.tokens.setTokenIcon, [
                tokenId,
                icon,
                proposeAs,
            ]);
        },
        onSuccess: (_data, { proposeAs }, _result, context) => {
            toast.success(successMessage("update", proposeAs));
            refreshIcons(context.client, user);
        },
        onError: (error) => {
            toast.error(error.message || "Failed to set token icon");
        },
    });

export const useRemoveTokenIcon = (user: string | null) =>
    useMutation<void, Error, { tokenId: number; proposeAs?: string }>({
        mutationKey: ["removeTokenIcon"],
        mutationFn: async ({ tokenId, proposeAs }) => {
            await callPluginFunction(homepage.tokens.removeTokenIcon, [
                tokenId,
                proposeAs,
            ]);
        },
        onSuccess: (_data, { proposeAs }, _result, context) => {
            toast.success(successMessage("removal", proposeAs));
            refreshIcons(context.client, user);
        },
        onError: (error) => {
            toast.error(error.message || "Failed to remove token icon");
        },
    });
