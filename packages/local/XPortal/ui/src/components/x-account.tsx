import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@shared/shadcn/ui/button";

import { getXIdentity, signOutOfX, xIdentityQueryKey } from "../lib/portal-api";

export const XAccount = () => {
    const queryClient = useQueryClient();
    const { data: identity, isPending } = useQuery({
        queryKey: xIdentityQueryKey,
        queryFn: getXIdentity,
    });
    const { mutate: signOut, isPending: isSigningOut } = useMutation({
        mutationFn: signOutOfX,
        onSuccess: () => queryClient.setQueryData(xIdentityQueryKey, null),
        onError: (error) => console.error("Sign out failed:", error),
    });

    if (isPending) return null;
    if (!identity) {
        return (
            <Button asChild size="sm">
                <a href="/auth/x/start">Sign in with X</a>
            </Button>
        );
    }
    return (
        <div className="flex items-center gap-3">
            <span className="text-sm">@{identity.handle}</span>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSigningOut}
                onClick={() => signOut()}
            >
                Sign out
            </Button>
        </div>
    );
};
