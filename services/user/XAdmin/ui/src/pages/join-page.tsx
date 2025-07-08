import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { useToast } from "@/components/ui/use-toast";

import { PrevNextButtons } from "@/components/PrevNextButtons";
import { KeyDeviceForm } from "@/components/forms/key-device-form";
import { Schema, UrlForm } from "@/components/forms/url";
import { Steps } from "@/components/steps";

import { useConnect } from "@/hooks/useConnect";
import { useStepper } from "@/hooks/useStepper";
import { KeyDeviceSchema } from "@/types";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { SetupWrapper } from "./setup-wrapper";

export const JoinPage = () => {
    const { mutateAsync: connect } = useConnect();

    const navigate = useNavigate();
    const { toast } = useToast();

    const keyDeviceForm = useForm<z.infer<typeof KeyDeviceSchema>>();

    const Step = {
        KeyDevice: "KEY_DEVICE",
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
    } = useStepper<StepKey>([{ step: Step.KeyDevice, form: keyDeviceForm }]);

    const onSubmit = async (data: Schema) => {
        const res = await connect(data);
        toast({
            title: "Success",
            description: `Connected to ${
                res.newPeer.url || res.newPeer.endpoint
            }.`,
        });
        navigate("/");
    };

    return (
        <SetupWrapper>
            <div className="flex h-full flex-col">
                <div className="flex flex-1 flex-col items-center justify-center space-y-20">
                    <Steps
                        currentStep={currentStepNum}
                        numberOfSteps={maxSteps}
                    />
                    {currentStep === Step.KeyDevice && (
                        <div className="flex justify-center">
                            <Card className="min-w-[350px]">
                                <CardHeader>
                                    <CardTitle>
                                        Select security device
                                    </CardTitle>
                                    <CardDescription>
                                        Where do you want your block producer
                                        server key to be stored?
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <KeyDeviceForm
                                        form={keyDeviceForm}
                                        next={next}
                                        deviceNotFoundErrorMessage="No security devices were found. Please ensure one is available. Alternatively, you may boot in an insecure keyless mode by going back and selecting the Development boot template."
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    )}
                    {currentStep === Step.Completion && (
                        <div>
                            <h1 className="mb-4 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
                                Join
                            </h1>
                            <p className="text-muted-foreground mt-3 leading-7">
                                Connect to a psibase compatible node to join a
                                network.
                            </p>
                            <div>
                                <UrlForm onSubmit={onSubmit} />
                            </div>
                        </div>
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
