import { useState } from "react";

import { CreatingStep } from "./creating-step";
import { FailedStep } from "./failed-step";
import { SignUpStep } from "./sign-up-step";
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
    const [step, setStep] = useState<Step>(initialStep);

    const fail = () => {
        forgetSignup();
        setStep({ kind: "failed" });
    };

    switch (step.kind) {
        case "sign-up":
            return (
                <SignUpStep
                    onRequested={(signupId) =>
                        setStep({ kind: "creating", signupId })
                    }
                    onClosed={onClosed}
                    onFailed={fail}
                />
            );
        case "creating":
            return <CreatingStep signupId={step.signupId} onFailed={fail} />;
        case "failed":
            return (
                <FailedStep onBack={() => setStep({ kind: "sign-up" })} />
            );
    }
};
