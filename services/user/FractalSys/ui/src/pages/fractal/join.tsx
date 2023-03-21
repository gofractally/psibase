import { useState } from "react";
import { useParams } from "react-router-dom";

import { useForm } from "react-hook-form";
import type { SubmitHandler } from "react-hook-form";

import { Button, Heading, Input, Text } from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import { useFractal } from "hooks/useParticipatingFractals";

enum Step {
    SignUp,
    CreateProfile,
    Success,
}

interface Profile {
    name: string;
}

export const Join = () => {
    const { fractalID } = useParams();
    const { data } = useFractal(fractalID);

    const [currentStep, setCurrentStep] = useState<Step>(Step.SignUp);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<Profile>({
        defaultValues: {
            name: "",
        },
    });

    if (currentStep === Step.SignUp) {
        return (
            <Con title="Accept invite">
                <div className="space-y-2">
                    <Heading tag="h2" styledAs="h4">
                        You are invited
                    </Heading>
                    <Text>
                        You are invited to the ƒractally {data?.displayName} fractal.
                        You need a psibase account to continue.
                    </Text>
                    <Text>
                        To finish setting up your ƒractally profile, sign up
                        with psibase.
                    </Text>
                    <Button
                        type="cta_fractally"
                        href={`${window.location.ancestorOrigins[0]}/applet/psiboard`}
                        isExternal
                        target="_parent"
                    >
                        Sign up with psibase
                    </Button>
                    <Button
                        type="secondary"
                        onClick={() => setCurrentStep(Step.CreateProfile)}
                    >
                        Temp: Skip to completion
                    </Button>
                </div>
            </Con>
        );
    }

    const onSubmitProfile: SubmitHandler<Profile> = async (data: Profile) => {
        setCurrentStep(Step.Success);
    };

    if (currentStep === Step.CreateProfile) {
        return (
            <Con title="Join">
                <div className="space-y-2">
                    <Heading tag="h2" styledAs="h4">
                        Create your ƒractally profile
                    </Heading>
                    <Text>
                        Enter your first and last name as you'd like it to
                        appear to other ƒractally members and submit your
                        profile to the{" "}
                        <span className="italic">{data?.displayName}</span> fractal.
                    </Text>
                    <form
                        onSubmit={handleSubmit(onSubmitProfile)}
                        className="mb-6 space-y-4"
                    >
                        <Input
                            label="Your name"
                            {...register("name", {
                                required:
                                    "You must enter your name to continue",
                            })}
                            errorText={errors.name?.message}
                            type="text"
                        />
                        <Button type="primary" isSubmit>
                            Submit
                        </Button>
                    </form>
                </div>
            </Con>
        );
    }

    if (currentStep === Step.Success) {
        return (
            <Con title="Join">
                <div className="space-y-2">
                    <Heading tag="h2" styledAs="h4">
                        Success!
                    </Heading>
                    <Text>
                        You are now a member of the{" "}
                        <span className="font-bold">{data?.displayName}</span> fractal.
                    </Text>
                </div>
            </Con>
        );
    }

    return null;
};
