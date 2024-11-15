import { Fragment } from "react";
import { cn } from "@/lib/utils";

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
                                "h-6 w-6 rounded-full bg-border transition-colors duration-300",
                                {
                                    "bg-primary": isPresentOrPast,
                                }
                            )}
                        ></div>
                        {!isFinalStep && (
                            <div
                                className={cn(
                                    `h-1 w-96 bg-border transition-all duration-300`,
                                    { "bg-primary": isHighlight }
                                )}
                            ></div>
                        )}
                    </Fragment>
                );
            })}
        </div>
    );
};
