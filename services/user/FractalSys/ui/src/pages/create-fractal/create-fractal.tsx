import {
    Button,
    Heading,
    Input,
    Select,
    TextArea,
} from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { SubmitHandler } from "react-hook-form";

enum Step {
    FractalInfo,
    MeetingInfo,
    Success,
}

interface FractalConfig {
    name: string;
    slug: string;
    description: string;
    lang: string;
}

export const CreateFractal = () => {
    const [currentStep, setCurrentStep] = useState<Step>(Step.FractalInfo);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<FractalConfig>({
        defaultValues: {
            name: "",
            slug: "",
            description: "",
            lang: "en-us",
        },
    });

    const onSubmit: SubmitHandler<FractalConfig> = async (
        data: FractalConfig
    ) => {
        alert("Fractal information submitted");
        console.log(data);
        // setCurrentStep(Step.Success);
    };

    if (currentStep !== Step.FractalInfo) return null;

    return (
        <Con title="Create Fractal">
            <div className="space-y-2">
                <Heading tag="h2" styledAs="h4">
                    Create a ƒractal
                </Heading>
                <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="mb-6 space-y-4"
                >
                    <Input
                        label="Fractal name"
                        {...register("name", {
                            required: "You must enter a name for your fractal",
                        })}
                        errorText={errors.name?.message}
                        type="text"
                        placeholder="Name"
                    />
                    <Input
                        label="Fractal slug"
                        {...register("slug", {
                            required: "You must enter a slug for your fractal",
                        })}
                        errorText={errors.slug?.message}
                        type="text"
                        placeholder="Slug"
                    />
                    <TextArea
                        label="Description"
                        {...register("description", {
                            required:
                                "Enter a few sentences to describe your fractal",
                        })}
                        type="text"
                        placeholder="Description"
                    />
                    <Select
                        {...register("lang", {
                            required:
                                "Select a language for your fractal meetings",
                        })}
                    >
                        <option value="en-us">EN-English</option>
                        <option value="es-es">ES-Spanish</option>
                        <option value="zh-cn">ZH-Chinese</option>
                    </Select>
                    <Button type="primary" isSubmit>
                        Submit
                    </Button>
                </form>
            </div>
        </Con>
    );
};
