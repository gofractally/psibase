import { Fragment } from "react";

import { cn } from "@shared/lib/utils";

export const Steps = ({
    currentStep,
    numberOfSteps,
}: {
    currentStep: number;
    numberOfSteps: number;
}) => {
    return (
        <div className="flex items-center ">
            {Array.from({ length: numberOfSteps }).map((_, index) => {
                const isPresentOrPast = currentStep >= index + 1;
                const isHighlight = currentStep > index + 1;
                const isFinalStep = index + 1 == numberOfSteps;
                return (
                    <Fragment key={index}>
                        <div
                            className={cn(
                                "bg-border h-6 w-6 rounded-full transition-colors duration-300",
                                {
                                    "bg-primary": isPresentOrPast,
                                },
                            )}
                        ></div>
                        {!isFinalStep && (
                            <div
                                className={cn(
                                    `bg-border h-1 w-96 transition-all duration-300`,
                                    { "bg-primary": isHighlight },
                                )}
                            ></div>
                        )}
                    </Fragment>
                );
            })}
        </div>
    );
};
