import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

import { PortalError } from "../lib/portal-api";
import { startSignup } from "../lib/signup-request";

export const SignUpStep = ({
    onRequested,
    onClosed,
    onFailed,
    onSignedOut,
}: {
    onRequested: (signupId: string) => void;
    /** The node stopped accepting requests. */
    onClosed: () => void;
    onFailed: () => void;
    onSignedOut: () => void;
}) => {
    const [alreadyRequested, setAlreadyRequested] = useState(false);
    const { mutate: signUp, isPending } = useMutation({
        mutationFn: startSignup,
        onSuccess: onRequested,
        onError: (error) => {
            if (error instanceof PortalError) {
                if (error.status === 403) {
                    onClosed();
                    return;
                }
                if (error.status === 401) {
                    onSignedOut();
                    return;
                }
                if (
                    error.status === 409 &&
                    error.message === "free signup already exists"
                ) {
                    setAlreadyRequested(true);
                    return;
                }
            }
            console.error("Signup request failed:", error);
            onFailed();
        },
    });

    return (
        <PageContainer className="space-y-6">
            <h2 className="text-lg font-medium">Request a free account</h2>
            {alreadyRequested && (
                <p className="text-destructive text-sm">
                    This X account already has a free account.
                </p>
            )}
            <div className="flex justify-end">
                <Button
                    type="button"
                    disabled={isPending}
                    onClick={() => signUp()}
                >
                    {isPending ? "Signing up..." : "Sign up"}
                </Button>
            </div>
        </PageContainer>
    );
};
