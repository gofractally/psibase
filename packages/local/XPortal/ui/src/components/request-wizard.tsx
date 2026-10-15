import { useState } from "react";

import { CreatingStep } from "./creating-step";
import { FailedStep } from "./failed-step";
import { NameStep } from "./name-step";
import type { SignupRequest } from "../lib/signup-request";

type Step =
    | { kind: "name"; name: string }
    | { kind: "creating"; request: SignupRequest }
    | { kind: "failed"; name: string };

export const RequestWizard = ({
    onClosed,
}: {
    /** The node stopped accepting requests. */
    onClosed: () => void;
}) => {
    const [step, setStep] = useState<Step>({ kind: "name", name: "" });

    switch (step.kind) {
        case "name":
            return (
                <NameStep
                    defaultName={step.name}
                    onRequested={(request) =>
                        setStep({ kind: "creating", request })
                    }
                    onClosed={onClosed}
                    onFailed={(name) => setStep({ kind: "failed", name })}
                />
            );
        case "creating":
            return (
                <CreatingStep
                    request={step.request}
                    onFailed={() =>
                        setStep({ kind: "failed", name: step.request.name })
                    }
                />
            );
        case "failed":
            return (
                <FailedStep
                    onBack={() => setStep({ kind: "name", name: step.name })}
                />
            );
    }
};
