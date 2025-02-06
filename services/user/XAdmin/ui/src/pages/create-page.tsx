import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// ShadCN UI Imports
import { useToast } from "@/components/ui/use-toast";

// components
import {
    ChainTypeForm,
    chainTypeSchema,
} from "@/components/forms/chain-mode-form";
import { BlockProducerForm } from "@/components/forms/block-producer";
import { KeyDeviceForm } from "@/components/forms/key-device-form";
import { MultiStepLoader } from "@/components/multi-step-loader";
import { PrevNextButtons } from "@/components/PrevNextButtons";
import { Steps } from "@/components/steps";
import { InstallationSummary } from "@/components/installation-summary";

// lib
import { bootChain } from "@/lib/bootChain";
import { calculateIndex } from "@/lib/calculateIndex";
import { getId } from "@/lib/getId";
import { getRequiredPackages } from "@/lib/getRequiredPackages";

// types
import {
    BootCompleteSchema,
    BootCompleteUpdate,
    PackageInfo,
    RequestUpdate,
    RequestUpdateSchema,
} from "../types";

// hooks
import { useAddServerKey } from "../hooks/useKeyDevices";
import { useConfig } from "../hooks/useConfig";
import { useImportAccount } from "../hooks/useImportAccount";
import { usePackages } from "../hooks/usePackages";
import { useSelectedRows } from "../hooks/useSelectedRows";
import { useStepper } from "../hooks/useStepper";
import { getDefaultSelectedPackages } from "../hooks/useTemplatedPackages";

// relative imports
import { SetupWrapper } from "./setup-wrapper";
import { DependencyDialog } from "./dependency-dialog";
import { generateP256Key } from "@/lib/keys";

export const BlockProducerSchema = z.object({
    name: z.string().min(1),
});

export const KeyDeviceSchema = z.object({
    id: z.string().min(1),
    pin: z.string().optional(),
});

interface DependencyState {
    show: boolean;
    removingPackage?: PackageInfo;
    dependencies: PackageInfo[];
}

let prom: (value: boolean) => void;

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

    const keyDeviceForm = useForm<z.infer<typeof KeyDeviceSchema>>();

    const isDev = chainTypeForm.watch("type") == "dev";
    const bpName = blockProducerForm.watch("name");
    const keyDevice = keyDeviceForm.watch("id");

    const Step = {
        ChainType: "CHAIN_TYPE",
        BlockProducer: "BLOCK_PRODUCER",
        KeyDevice: "KEY_DEVICE",
        Confirmation: "CONFIRMATION",
        Completion: "COMPLETION",
    } as const;

    type StepKey = (typeof Step)[keyof typeof Step];

    const {
        canNext,
        canPrev,
        next,
        previous,
        currentStepNum,
        currentStep,
        maxSteps,
    } = useStepper<StepKey>([
        { step: Step.ChainType, form: chainTypeForm },
        { step: Step.BlockProducer, form: blockProducerForm },
        { step: Step.KeyDevice, form: keyDeviceForm, skip: isDev },
        { step: Step.Confirmation },
    ]);

    const { data: packages } = usePackages();

    const suggestedSelection = getDefaultSelectedPackages(
        {
            dev: isDev,
        },
        packages
    );

    const { mutateAsync: createAndSetKey } = useAddServerKey();
    const { mutateAsync: importAccount } = useImportAccount();

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
        if (currentStep === Step.Confirmation) {
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
                let keyPair: CryptoKeyPair | undefined;
                if (!isDev) {
                    await createAndSetKey(keyDevice); // create and set server block signing key
                    keyPair = await generateP256Key(); // bp account tx signing key
                }
                const desiredPackageIds = Object.keys(rows);
                const desiredPackages = packages.filter((pack) =>
                    desiredPackageIds.some((id) => id == getId(pack))
                );
                const requiredPackages = getRequiredPackages(
                    packages,
                    desiredPackages.map((pack) => pack.name)
                );
                bootChain({
                    packages: requiredPackages,
                    producerName: bpName,
                    publicKey: keyPair?.publicKey,
                    compression: isDev ? 4 : 7,
                    onProgressUpdate: (state) => {
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

                                importAccount({
                                    privateKey: keyPair?.privateKey,
                                    account: bpName,
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
                    },
                });
            } catch (e) {
                console.error("Error booting chain");
                console.error(e);
            }
        };

        if (currentStep === Step.Completion && !installRan.current && config) {
            setLoading(true);
            installRan.current = true;
            setKeysAndBoot();
        } else if (currentStep === Step.Confirmation) {
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
                            currentStep={currentStepNum}
                            numberOfSteps={maxSteps}
                        />
                    </div>
                    {currentStep === Step.ChainType && (
                        <div>
                            <h1 className="mb-4 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
                                Boot template
                            </h1>
                            <ChainTypeForm form={chainTypeForm} next={next} />
                        </div>
                    )}
                    {currentStep === Step.BlockProducer && (
                        <div>
                            <h1 className="mb-4 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
                                Name yourself
                            </h1>
                            <BlockProducerForm
                                form={blockProducerForm}
                                next={next}
                            />
                        </div>
                    )}
                    {currentStep === Step.KeyDevice && (
                        <div className="flex justify-center">
                            <KeyDeviceForm form={keyDeviceForm} next={next} />
                        </div>
                    )}
                    {currentStep === Step.Confirmation && (
                        <InstallationSummary
                            isDev={isDev}
                            bpName={bpName}
                            keyDevice={keyDevice}
                            rows={rows}
                            setRows={setRows}
                            packages={packages}
                        />
                    )}
                    {currentStep === Step.Completion && (
                        <div>{errorMessage}</div>
                    )}
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
