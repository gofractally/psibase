import { useState } from "react";
import { UseFormReturn } from "react-hook-form";

export const useStepper = (
    numberOfSteps: number,
    formsOrFunctions: (UseFormReturn<any> | string)[]
) => {
    const [currentStep, setStep] = useState(1);
    const canNext = currentStep < numberOfSteps;
    const canPrev = currentStep > 1;

    const next = async () => {
        if (canNext) {
            const currentChecker = formsOrFunctions[currentStep - 1];
            const isPassable =
                typeof currentChecker == "string"
                    ? !!currentChecker
                    : await currentChecker.trigger();
            if (isPassable) {
                setStep((step) => (canNext ? step + 1 : step));
            }
        }
    };

    const previous = () => {
        setStep((step) => (canPrev ? step - 1 : step));
    };

    return {
        currentStep,
        maxSteps: numberOfSteps,
        next,
        previous,
        canPrev,
        canNext,
    };
};
