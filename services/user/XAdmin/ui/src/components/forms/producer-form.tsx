import { InstallType, ProducerType } from "@/types";
import { UseFormReturn } from "react-hook-form";
import { Label } from "@shared/shadcn/ui/label";
import { Input } from "@shared/shadcn/ui/input";
import { Button } from "@shared/shadcn/ui/button";

interface ProducerFormProps {
    producerForm: UseFormReturn<ProducerType>;
    typeForm: UseFormReturn<InstallType>;
    setCurrentPage: (page: string) => void;
}

export const ProducerForm = ({
    producerForm,
    typeForm,
    setCurrentPage,
}: ProducerFormProps) => {
    return (
        <>
            <form onSubmit={() => setCurrentPage("install")}>
                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="bp-name">Block producer name</Label>
                    <Input
                        id="bp-name"
                        {...producerForm.register("producer", {
                            required: true,
                            pattern: /[-a-z0-9]+/,
                        })}
                    />
                </div>

                <Button
                    className="mt-4 "
                    variant="secondary"
                    onClick={() => {
                        const installType = typeForm.getValues("installType");
                        if (installType == "full") {
                            setCurrentPage("type");
                        } else if (installType == "custom") {
                            setCurrentPage("services");
                        }
                    }}
                >
                    Back
                </Button>
                <Button
                    className="mt-4"
                    type="submit"
                    disabled={!producerForm.formState.isValid}
                >
                    Next
                </Button>
            </form>
        </>
    );
};
