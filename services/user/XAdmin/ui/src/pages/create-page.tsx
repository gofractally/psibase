import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
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
    ChainTypeForm,
    chainTypeSchema,
} from "@/components/forms/chain-mode-form";
import { BlockProducerForm } from "@/components/forms/block-producer";
import { ConfirmationForm } from "@/components/forms/confirmation-form";

import { usePackages } from "../hooks/usePackages";
import {
    BootCompleteSchema,
    BootCompleteUpdate,
    PackageInfo,
    RequestUpdate,
    RequestUpdateSchema,
} from "../types";

import { useSelectedRows } from "../hooks/useSelectedRows";
import { Steps } from "@/components/steps";
import { DependencyDialog } from "./dependency-dialog";
import { getDefaultSelectedPackages } from "../hooks/useTemplatedPackages";
import { getId } from "@/lib/getId";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { MultiStepLoader } from "@/components/multi-step-loader";
import { getRequiredPackages } from "../lib/getRequiredPackages";
import { bootChain } from "../lib/bootChain";
import { useConfig } from "../hooks/useConfig";
import { useToast } from "@/components/ui/use-toast";

import { useNavigate } from "react-router-dom";

const useStepper = (
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
}: PrevNextProps) => (
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

const BlockProducerSchema = z.object({
    name: z.string().min(2),
});

interface DependencyState {
    show: boolean;
    removingPackage?: PackageInfo;
    dependencies: PackageInfo[];
}

let prom: (value: boolean) => void;

interface Props {
    label: string;
    value: string;
}

const Card = ({ label, value }: Props) => (
    <div className="w-60 rounded-md border p-2 text-right">
        <div className="text-sm text-muted-foreground">{label}</div>
        {value}
    </div>
);

const calculateIndex = (
    packagesLength: number,
    currentTx: number,
    totalTransactions: number
) => {
    const percentProgressed = currentTx / totalTransactions;
    return Math.floor(percentProgressed * (packagesLength - 1));
};

const isRequestingUpdate = (data: unknown): data is RequestUpdate =>
    RequestUpdateSchema.safeParse(data).success;

const isBootCompleteUpdate = (data: unknown): data is BootCompleteUpdate =>
    BootCompleteSchema.safeParse(data).success;

export const CreatePage = () => {
    const blockProducerForm = useForm<z.infer<typeof BlockProducerSchema>>({
        resolver: zodResolver(BlockProducerSchema),
        defaultValues: {
            name: "",
        },
    });

    const navigate = useNavigate();
    const { toast } = useToast();

    const { data: config, refetch: refetchConfig } = useConfig();

    const chainTypeForm = useForm<z.infer<typeof chainTypeSchema>>({
        resolver: zodResolver(chainTypeSchema),
    });

    const { canNext, canPrev, next, previous, currentStep, maxSteps } =
        useStepper(4, [chainTypeForm, blockProducerForm, "a"]);

    const { data: packages } = usePackages();

    const isDev = chainTypeForm.watch("type") == "dev";

    const suggestedSelection = getDefaultSelectedPackages(
        {
            dev: isDev,
        },
        packages
    );

    console.log(JSON.stringify(packages.map((x) => x.name)));

    const [
        { dependencies, show: showDependencyDialog, removingPackage },
        setWarningState,
    ] = useState<DependencyState>({
        dependencies: [],
        show: false,
    });

    const [rows, setRows, overWriteRows] = useSelectedRows(
        packages,
        async (warning) => {
            setWarningState({
                removingPackage: warning.removedPackage,
                dependencies: warning.dependencies,
                show: true,
            });
            return new Promise((resolve) => {
                prom = resolve;
            });
        }
    );

    console.log(rows, "rows");

    useEffect(() => {
        if (currentStep == 3) {
            console.log("running");
            const state = suggestedSelection.selectedPackages.reduce(
                (acc, item) => ({ ...acc, [getId(item)]: true }),
                {}
            );

            console.log(state, "should be set too");
            overWriteRows(state);
        }
    }, [currentStep]);

    const [loading, setLoading] = useState(false);

    const selectedPackageIds = Object.keys(rows);
    const selectedPackages = packages.filter((pack) =>
        selectedPackageIds.some((id) => id == getId(pack))
    );

    const loadingStates = selectedPackages.map((pack) => ({
        text: `Installing ${pack.name}..`,
    }));

    const installRan = useRef(false);
    const bpName = blockProducerForm.watch("name");

    const [currentState, setCurrentState] = useState(1);

    useEffect(() => {
        if (currentStep == 4 && !installRan.current && config) {
            setLoading(true);
            installRan.current = true;
            const desiredPackageIds = Object.keys(rows);
            const desiredPackages = packages.filter((pack) =>
                desiredPackageIds.some((id) => id == getId(pack))
            );
            const requiredPackages = getRequiredPackages(
                packages,
                desiredPackages.map((pack) => pack.name)
            );
            bootChain(
                requiredPackages,
                bpName,
                config,
                () => {
                    refetchConfig();
                },
                (state) => {
                    if (isRequestingUpdate(state)) {
                        const [_, current, total] = state;
                        const newIndex = calculateIndex(
                            loadingStates.length,
                            current,
                            total
                        );
                        setCurrentState(newIndex);
                    } else if (isBootCompleteUpdate(state)) {
                        if (state.success) {
                            navigate("/Dashboard");
                            setCurrentState(loadingStates.length + 1);
                            toast({
                                title: "Success",
                                description: "Successfully booted chain.",
                            });
                        }
                    } else {
                        console.log(state, "Unrecognised message.");
                    }
                }
            );
        }
    }, [currentStep, rows, bpName, config]);

    return (
        <SetupWrapper>
            <DependencyDialog
                removingPackage={removingPackage}
                show={showDependencyDialog}
                dependencies={dependencies}
                onResponse={(confirmed) => {
                    setWarningState((res) => ({
                        ...res,
                        show: false,
                    }));
                    prom(confirmed);
                }}
            />
            <MultiStepLoader
                loadingStates={loadingStates}
                loading={loading}
                currentState={currentState}
            />
            <div className="flex h-full flex-col  ">
                <div className="my-auto flex h-full flex-col justify-between sm:h-5/6">
                    <Steps currentStep={currentStep} numberOfSteps={maxSteps} />
                    {currentStep == 1 && (
                        <div>
                            <ChainTypeForm form={chainTypeForm} />
                        </div>
                    )}
                    {currentStep == 2 && (
                        <div>
                            <BlockProducerForm form={blockProducerForm} />
                        </div>
                    )}
                    {currentStep == 3 && (
                        <div className="px-4">
                            <div className="grid grid-cols-2 py-6">
                                <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
                                    Installation summary
                                </h1>{" "}
                                <div className="flex flex-row-reverse ">
                                    <div className="flex flex-col gap-3  ">
                                        <Card
                                            label="Template"
                                            value={
                                                isDev
                                                    ? "Developer"
                                                    : "Production"
                                            }
                                        />

                                        <Card
                                            label="Block Producer Name"
                                            value="orelosoftware"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="max-h-[600px] ">
                                <Accordion type="single" collapsible>
                                    <AccordionItem value="item-1">
                                        <AccordionTrigger className="w-60">
                                            Advanced
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <ConfirmationForm
                                                rowSelection={rows}
                                                onRowSelectionChange={setRows}
                                                packages={packages}
                                            />
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            </div>
                        </div>
                    )}
                    {currentStep == 4 && <div>better</div>}
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
