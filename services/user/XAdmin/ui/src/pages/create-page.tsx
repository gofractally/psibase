import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// ShadCN UI Imports
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/components/ui/use-toast";

// components
import {
    ChainTypeForm,
    chainTypeSchema,
} from "@/components/forms/chain-mode-form";
import { BlockProducerForm } from "@/components/forms/block-producer";
import { ConfirmationForm } from "@/components/forms/confirmation-form";
import { MultiStepLoader } from "@/components/multi-step-loader";
import { PrevNextButtons } from "@/components/PrevNextButtons";
import { Steps } from "@/components/steps";

// hooks
import { useAddServerKey } from "@/hooks/useAddServerKey";
import { useConfig } from "@/hooks/useConfig";
import { usePackages } from "@/hooks/usePackages";
import { useSelectedRows } from "@/hooks/useSelectedRows";
import { useStepper } from "@/hooks/useStepper";
import { getDefaultSelectedPackages } from "@/hooks/useTemplatedPackages";

// lib
import { bootChain } from "@/lib/bootChain";
import { calculateIndex } from "@/lib/calculateIndex";
import { getId } from "@/lib/getId";
import { getRequiredPackages } from "@/lib/getRequiredPackages";
import {
    BootCompleteSchema,
    BootCompleteUpdate,
    PackageInfo,
    RequestUpdate,
    RequestUpdateSchema,
} from "@/types";

// relative imports
import { SetupWrapper } from "./setup-wrapper";
import { DependencyDialog } from "./dependency-dialog";

const BlockProducerSchema = z.object({
    name: z.string().min(1),
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

    const { data: config } = useConfig();

    const chainTypeForm = useForm<z.infer<typeof chainTypeSchema>>({
        resolver: zodResolver(chainTypeSchema),
    });

    const { canNext, canPrev, next, previous, currentStep, maxSteps } =
        useStepper(4, [chainTypeForm, blockProducerForm, "a"]);

    const { data: packages } = usePackages();

    const isDev = chainTypeForm.watch("type") == "dev";
    const bpName = blockProducerForm.watch("name");

    const suggestedSelection = getDefaultSelectedPackages(
        {
            dev: isDev,
        },
        packages
    );

    const { mutateAsync: createAndSetKey } = useAddServerKey();

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

    useEffect(() => {
        if (currentStep == 3) {
            const state = suggestedSelection.reduce(
                (acc, item) => ({ ...acc, [getId(item)]: true }),
                {}
            );

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
    const [errorMessage, setErrorMessage] = useState<string>("");

    const [currentState, setCurrentState] = useState(1);

    useEffect(() => {
        const setKeysAndBoot = async () => {
            try {
                if (!isDev) {
                    await createAndSetKey();
                }
                const desiredPackageIds = Object.keys(rows);
                const desiredPackages = packages.filter((pack) =>
                    desiredPackageIds.some((id) => id == getId(pack))
                );
                const requiredPackages = getRequiredPackages(
                    packages,
                    desiredPackages.map((pack) => pack.name)
                );
                bootChain(requiredPackages, bpName, (state) => {
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
                        } else {
                            setLoading(false);
                            const message = "Something went wrong.";
                            toast({
                                title: "Error",
                                description: message,
                            });
                            setErrorMessage(message);
                        }
                    } else {
                        console.warn(state, "Unrecognised message.");
                    }
                });
            } catch (e) {
                console.error("Error booting chain");
                console.error(e);
            }
        };

        if (currentStep == 4 && !installRan.current && config) {
            setLoading(true);
            installRan.current = true;
            setKeysAndBoot();
        } else if (currentStep == 3) {
            // This case allows the user to retry after a failed step 4.
            if (installRan.current) {
                installRan.current = false;
            }
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
            <div className="relative flex h-full flex-col justify-between ">
                <div></div>
                <div className="flex flex-col">
                    <div className="pb-20">
                        <Steps
                            currentStep={currentStep}
                            numberOfSteps={maxSteps}
                        />
                    </div>
                    {currentStep == 1 && (
                        <div>
                            <h1 className="mb-4 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
                                Boot template
                            </h1>{" "}
                            <ChainTypeForm form={chainTypeForm} next={next} />
                        </div>
                    )}
                    {currentStep == 2 && (
                        <div>
                            <h1 className="mb-4 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
                                Name yourself
                            </h1>{" "}
                            <BlockProducerForm
                                form={blockProducerForm}
                                next={next}
                            />
                        </div>
                    )}
                    {currentStep == 3 && (
                        <div className="px-4">
                            <div className="grid grid-cols-2 py-6">
                                <h1 className="scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
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
                                            value={bpName}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="max-h-full ">
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
                    {currentStep == 4 && <div>{errorMessage}</div>}
                </div>
                <div className="py-4">
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
