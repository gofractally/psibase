import { useState } from "react";

import { ConfirmKeyStep } from "./account-key/confirm-key-step";
import { SaveKeyStep } from "./account-key/save-key-step";

export type KeyStep = "save" | "confirm";

export const SaveAndConfirmKey = ({
    accountName,
    keyB64,
    onImported,
    onStepChange,
}: {
    accountName: string;
    keyB64: string;
    onImported: (account: string) => Promise<void> | void;
    onStepChange?: (step: KeyStep) => void;
}) => {
    const [step, setStep] = useState<KeyStep>("save");

    const setKeyStep = (next: KeyStep) => {
        setStep(next);
        onStepChange?.(next);
    };

    if (step === "save") {
        return (
            <SaveKeyStep
                accountName={accountName}
                keyB64={keyB64}
                onContinue={() => setKeyStep("confirm")}
            />
        );
    }

    return (
        <ConfirmKeyStep
            expectedAccount={accountName}
            onBack={() => setKeyStep("save")}
            onImported={onImported}
        />
    );
};
