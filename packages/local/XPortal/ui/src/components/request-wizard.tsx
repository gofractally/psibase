import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CreatingStep } from "./creating-step";
import { FailedStep } from "./failed-step";
import { Loader } from "./loader";
import { SignInStep } from "./sign-in-step";
import { SignUpStep } from "./sign-up-step";
import { getXIdentity, xIdentityQueryKey } from "../lib/portal-api";
import { forgetSignup, storedSignupId } from "../lib/signup-request";

type Step =
    | { kind: "sign-up" }
    | { kind: "creating"; signupId: string }
    | { kind: "failed" };

const initialStep = (): Step => {
    const signupId = storedSignupId();
    return signupId ? { kind: "creating", signupId } : { kind: "sign-up" };
};

export const RequestWizard = ({
    onClosed,
}: {
    /** The node stopped accepting requests. */
    onClosed: () => void;
}) => {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<Step>(initialStep);
    const { data: identity, isPending } = useQuery({
        queryKey: xIdentityQueryKey,
        queryFn: getXIdentity,
    });

    const fail = () => {
        forgetSignup();
        setStep({ kind: "failed" });
    };
    const signedOut = () => {
        queryClient.setQueryData(xIdentityQueryKey, null);
    };

    if (step.kind === "failed") {
        return <FailedStep onBack={() => setStep({ kind: "sign-up" })} />;
    }
    if (isPending) return <Loader />;
    if (!identity) return <SignInStep />;
    if (step.kind === "creating") {
        return (
            <CreatingStep
                signupId={step.signupId}
                onFailed={fail}
                onSignedOut={signedOut}
            />
        );
    }
    return (
        <SignUpStep
            onRequested={(signupId) => setStep({ kind: "creating", signupId })}
            onClosed={onClosed}
            onFailed={fail}
            onSignedOut={signedOut}
        />
    );
};
