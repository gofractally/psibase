import { Controller, UseFormReturn } from "react-hook-form";

import { InstallType } from "@/types";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { RadioGroup, RadioGroupItem } from "@shared/shadcn/ui/radio-group";

interface TypeFormProps {
    setPackages: (names: string[]) => void;
    typeForm: UseFormReturn<InstallType>;
    setCurrentPage: (page: string) => void;
}

export const TypeForm = ({
    setPackages,
    typeForm,
    setCurrentPage,
}: TypeFormProps) => {
    return (
        <form
            onSubmit={typeForm.handleSubmit((state) => {
                if (state.installType == "full") {
                    setPackages(["Default"]);
                    setCurrentPage("producer");
                } else if (state.installType == "custom") {
                    setCurrentPage("services");
                }
            })}
        >
            <Controller
                name="installType"
                control={typeForm.control}
                render={({ field }) => (
                    <RadioGroup
                        defaultValue={field.value || "full"}
                        onValueChange={field.onChange}
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="full" id="option-one" />
                            <Label htmlFor="option-one">
                                Install all services
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="custom" id="option-two" />
                            <Label htmlFor="option-two">
                                Choose services to install
                            </Label>
                        </div>
                    </RadioGroup>
                )}
            />

            <Button className="mt-4" type="submit">
                Next
            </Button>
        </form>
    );
};
