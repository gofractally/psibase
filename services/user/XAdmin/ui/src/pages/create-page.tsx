import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Fragment, useState } from "react";
import {
    ChevronRight,
    ChevronLeft,
    ChevronLast,
    ChevronFirst,
} from "lucide-react";
import { SetupWrapper } from "./setup-wrapper";

import { zodResolver } from "@hookform/resolvers/zod";
import { UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const useStepper = (numberOfSteps: number, forms: UseFormReturn<any>[]) => {
    const [currentStep, setStep] = useState(1);
    const canNext = currentStep < numberOfSteps;
    const canPrev = currentStep > 1;

    const next = async () => {
        if (canNext) {
            const res = await forms[currentStep - 1].trigger();
            if (res) {
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

const Steps = ({
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

interface PrevNextProps {
    previous: () => void;
    next: () => void;
    canPrev: boolean;
    canNext: boolean;
}

const PrevNextButtons = ({
    canNext,
    canPrev,
    next,
    previous,
}: PrevNextProps) => {
    return (
        <div className="flex w-full justify-between">
            <Button
                variant="ghost"
                onClick={() => {
                    previous();
                }}
                disabled={!canPrev}
            >
                {canPrev ? <ChevronLeft /> : <ChevronFirst />}
            </Button>

            <Button
                variant="ghost"
                onClick={() => {
                    next();
                }}
                disabled={!canNext}
            >
                {canNext ? <ChevronRight /> : <ChevronLast />}
            </Button>
        </div>
    );
};

const BlockProducerSchema = z.object({
    name: z.string().min(2),
});
const PortsSchema = z.object({
    ports: z.string().min(4),
});

type BlockProducerShape = z.infer<typeof BlockProducerSchema>;
type PortsShape = z.infer<typeof PortsSchema>;

interface Props {
    form: UseFormReturn<BlockProducerShape>;
}

const defaultValues = {
    name: "",
};

export const BlockProducerForm = ({ form }: Props) => (
    <Form {...form}>
        <form className="space-y-6">
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <Input
                                placeholder="Block producer name"
                                {...field}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </form>
    </Form>
);

export const PortsForm = ({
    form,
    onSubmit,
}: {
    form: UseFormReturn<PortsShape>;
    onSubmit?: (data: PortsShape) => void;
}) => (
    <Form {...form}>
        <form
            onSubmit={onSubmit ? form.handleSubmit(onSubmit) : undefined}
            className="space-y-6"
        >
            <FormField
                control={form.control}
                name="ports"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <Input placeholder="Ports name" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            {onSubmit && (
                <div className="flex w-full flex-row-reverse">
                    <Button type="submit">Submit</Button>
                </div>
            )}
        </form>
    </Form>
);

export const CreatePage = () => {
    const blockProducerForm = useForm<z.infer<typeof BlockProducerSchema>>({
        resolver: zodResolver(BlockProducerSchema),
        defaultValues: {
            name: "",
        },
    });

    const portsForm = useForm<z.infer<typeof PortsSchema>>({
        resolver: zodResolver(PortsSchema),
        defaultValues: {
            ports: "",
        },
    });

    const { canNext, canPrev, next, previous, currentStep, maxSteps } =
        useStepper(4, [blockProducerForm, portsForm]);

    return (
        <SetupWrapper>
            <div className="flex h-full flex-col ">
                <div className="my-auto flex h-full flex-col justify-between sm:h-5/6">
                    <Steps currentStep={currentStep} numberOfSteps={maxSteps} />
                    {currentStep == 1 && (
                        <div>
                            <BlockProducerForm form={blockProducerForm} />
                        </div>
                    )}
                    {currentStep == 2 && (
                        <div>
                            <PortsForm
                                onSubmit={(e) => console.log(e)}
                                form={portsForm}
                            />
                        </div>
                    )}
                    {currentStep == 3 && <div>Step 3</div>}
                    {currentStep == 4 && <div>Step 4</div>}
                    <PrevNextButtons
                        canNext={canNext}
                        canPrev={canPrev}
                        next={next}
                        previous={previous}
                    />
                </div>
            </div>
        </SetupWrapper>
    );
};
