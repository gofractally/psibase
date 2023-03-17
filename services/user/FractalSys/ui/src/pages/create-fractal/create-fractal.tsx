import { useState } from "react";

import { useForm } from "react-hook-form";
import type { SubmitHandler } from "react-hook-form";

import {
    Button,
    FileInput,
    Heading,
    Input,
    Select,
    Text,
    TextArea,
} from "@toolbox/components/ui";
import { Con } from "components/layouts/con";

enum Step {
    FractalInfo,
    MeetingInfo,
    Success,
}

interface FractalConfig {
    name: string;
    slug: string;
    description: string;
    language: string;
    coc: FileList;
}

export const CreateFractal = () => {
    // TODO: Hook up to contract for fractal creation
    // TODO: Use react-hook-form validation to enforce field-level constraints
    // TODO: Populate select field with proper language options
    // TODO: Add drag-and-drop code-of-conduct field
    // TODO: Add support for next step(s)
    const [currentStep, setCurrentStep] = useState<Step>(Step.FractalInfo);

    const {
        register,
        handleSubmit,
        formState: { errors },
        getValues,
        watch,
    } = useForm<FractalConfig>({
        defaultValues: {
            name: "",
            slug: "",
            description: "",
            language: "en-us",
            coc: undefined,
        },
    });

    const watchCoc = watch("coc");
    const cocFileName = watchCoc?.[0]?.name;

    console.log(getValues());

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
                        errorText={errors.description?.message}
                        type="text"
                        placeholder="Description"
                        rows={4}
                    />
                    <Select
                        label="Language"
                        {...register("language", {
                            required:
                                "Select a language for your fractal meetings",
                        })}
                        errorText={errors.language?.message}
                    >
                        <option value="en-us">EN-English</option>
                        <option value="es-es">ES-Spanish</option>
                        <option value="zh-cn">ZH-Chinese</option>
                    </Select>
                    <div>
                        <FileInput
                            label={
                                cocFileName
                                    ? "Replace attached code of conduct file"
                                    : "Attach a code of conduct"
                            }
                            {...register("coc")}
                            accept=".pdf,.doc,.docx,.xml,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        />
                        <Text>
                            {cocFileName ? (
                                <>
                                    <span className="font-medium">
                                        Attached:{" "}
                                    </span>
                                    {cocFileName}
                                </>
                            ) : null}
                        </Text>
                    </div>
                    <Button type="primary" isSubmit>
                        Submit
                    </Button>
                </form>
            </div>
        </Con>
    );
};
