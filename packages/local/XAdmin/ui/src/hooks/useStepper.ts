import { useState } from "react";

type Step<T> = {
    step: T | "BOOT_SUCCESS";
    skip?: boolean;
    checkCanProceed?: () => Promise<boolean>;
    noPrev?: boolean;
};

/**
 *
 * @param steps - Include all steps except final COMPLETION step, which is included implicitly
 */
export const useStepper = <T>(steps: Step<T>[]) => {
    const [currentStepNum, setStepNum] = useState(1);
    const availableSteps = steps.filter((f) => !f.skip);
    const numberOfSteps = availableSteps.length;
    const currentStep = availableSteps[currentStepNum - 1];

    const canNext = currentStepNum < numberOfSteps + 1;
    const canPrev = !currentStep?.noPrev;

    const next = async () => {
        if (canNext) {
            const currentChecker = currentStep.checkCanProceed;
            const isPassable = !currentChecker || (await currentChecker?.());
            if (isPassable) {
                setStepNum((step) => (canNext ? step + 1 : step));
            }
        }
    };

    const previous = () => {
        setStepNum((step) => (canPrev ? step - 1 : step));
    };

    const isComplete = currentStepNum == numberOfSteps + 1;

    return {
        currentStepNum,
        currentStep: isComplete ? "BOOT_COMPLETE" : currentStep.step,
        maxSteps: numberOfSteps,
        next,
        previous,
        canPrev,
        canNext,
    };
};
