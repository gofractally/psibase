import { useState } from "react";
import { UseFormReturn } from "react-hook-form";

type Step<T> = {
    step: T | "COMPLETION";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form?: UseFormReturn<any>;
    skip?: boolean;
};

/**
 *
 * @param steps - Include all steps except final COMPLETION step, which is included implicitly
 */
export const useStepper = <T>(steps: Step<T>[]) => {
    const [currentStepNum, setStepNum] = useState(1);
    const availableSteps = steps.filter((f) => !f.skip);

    const numberOfSteps = availableSteps.length + 1;

    const canNext = currentStepNum < numberOfSteps;
    const canPrev = currentStepNum > 1;

    const next = async () => {
        if (canNext) {
            const currentChecker = availableSteps[currentStepNum - 1].form;
            const isPassable =
                !currentChecker || (await currentChecker?.trigger());
            if (isPassable) {
                setStepNum((step) => (canNext ? step + 1 : step));
            }
        }
    };

    const previous = () => {
        setStepNum((step) => (canPrev ? step - 1 : step));
    };

    const isComplete = currentStepNum == numberOfSteps;

    return {
        currentStepNum,
        currentStep: isComplete
            ? "COMPLETION"
            : availableSteps[currentStepNum - 1].step,
        maxSteps: numberOfSteps,
        next,
        previous,
        canPrev,
        canNext,
    };
};
