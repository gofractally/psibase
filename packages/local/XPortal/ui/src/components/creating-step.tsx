import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { PageContainer } from "@shared/components/page-container";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { IMPORT_RETURN_PATH } from "../lib/import-return";
import { getSignup, PortalError } from "../lib/portal-api";
import { importInvite } from "../lib/signup-request";

const POLL_INTERVAL_MS = 1000;

/**
 * Once the node creates the invite, leaves the page for the host login
 * prompt, which returns to `IMPORT_RETURN_PATH`.
 */
export const CreatingStep = ({
    signupId,
    onFailed,
    onSignedOut,
}: {
    signupId: string;
    onFailed: () => void;
    onSignedOut: () => void;
}) => {
    const { data: signup, isError, error } = useQuery({
        queryKey: ["signup", signupId],
        queryFn: () => getSignup(signupId),
        retry: (failureCount, queryError) =>
            !(queryError instanceof PortalError && queryError.status === 401) &&
            failureCount < 3,
        refetchInterval: (query) => {
            const queryError = query.state.error;
            if (queryError instanceof PortalError && queryError.status === 401)
                return false;
            return query.state.data?.state === "queued"
                ? POLL_INTERVAL_MS
                : false;
        },
    });

    const { mutateAsync: connectAccount } = useConnectAccount();
    const { mutate: redeemInLoginPrompt, isIdle: isRedeemIdle } = useMutation({
        mutationFn: async (token: string) => {
            await importInvite(token);
            await connectAccount({
                enabled: true,
                returnPath: IMPORT_RETURN_PATH,
            });
        },
        onError: (error) => {
            console.error("Failed to open the login prompt:", error);
            onFailed();
        },
    });

    useEffect(() => {
        if (error instanceof PortalError && error.status === 401) {
            onSignedOut();
            return;
        }
        if (isError || signup?.state === "failed") {
            onFailed();
        } else if (signup?.state === "invited" && isRedeemIdle) {
            redeemInLoginPrompt(signup.token);
        }
    }, [
        signup,
        isError,
        error,
        isRedeemIdle,
        redeemInLoginPrompt,
        onFailed,
        onSignedOut,
    ]);

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">Getting things ready...</h2>
                <p className="text-muted-foreground text-sm">
                    This should only take a few seconds.
                </p>
            </div>
            <div className="bg-muted/40 flex items-center justify-center rounded-lg border px-6 py-10">
                <Spinner className="text-muted-foreground size-5" />
            </div>
        </PageContainer>
    );
};
