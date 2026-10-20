import { useMutation } from "@tanstack/react-query";

import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

import { PortalError } from "../lib/portal-api";
import { startSignup } from "../lib/signup-request";

export const SignUpStep = ({
    onRequested,
    onClosed,
    onFailed,
}: {
    onRequested: (signupId: string) => void;
    /** The node stopped accepting requests. */
    onClosed: () => void;
    onFailed: () => void;
}) => {
    const { mutate: signUp, isPending } = useMutation({
        mutationFn: startSignup,
        onSuccess: onRequested,
        onError: (error) => {
            if (error instanceof PortalError && error.status === 403) {
                onClosed();
            } else {
                console.error("Signup request failed:", error);
                onFailed();
            }
        },
    });

    return (
        <PageContainer className="space-y-6">
            <h2 className="text-lg font-medium">Request a free account</h2>
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
