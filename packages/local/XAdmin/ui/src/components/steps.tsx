import { cn } from "@shared/lib/utils";

export const Steps = ({
    currentStep,
    numberOfSteps,
}: {
    currentStep: number;
    numberOfSteps: number;
}) => {
    return (
        <div className="space-y-2">
            <div className="flex w-full items-center gap-2">
                {Array.from({ length: numberOfSteps }).map((_, index) => (
                    <div
                        key={index}
                        className={cn(
                            "h-1.5 flex-1 rounded-full transition-colors duration-300",
                            currentStep > index ? "bg-primary" : "bg-muted",
                        )}
                    />
                ))}
            </div>
            <p className="text-muted-foreground text-xs">
                Step {Math.min(currentStep, numberOfSteps)} of {numberOfSteps}
            </p>
        </div>
    );
};
