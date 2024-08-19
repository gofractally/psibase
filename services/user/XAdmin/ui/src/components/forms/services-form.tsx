import { PackageInfo, ServicesType } from "@/types";
import { Controller, UseFormReturn } from "react-hook-form";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { filterHighestVersions } from "@/lib/filterHighestVersions";

interface ServicesFormProps {
    setPackages: (names: string[]) => void;
    serviceIndex: PackageInfo[];
    servicesForm: UseFormReturn<ServicesType>;
    setCurrentPage: (page: string) => void;
}

export const ServicesForm = ({
    setPackages,
    serviceIndex,
    servicesForm,
    setCurrentPage,
}: ServicesFormProps) => {
    const filteredPackages = filterHighestVersions(serviceIndex);

    return (
        <form
            onSubmit={servicesForm.handleSubmit((state) => {
                setPackages(
                    serviceIndex
                        .map((meta) => meta.name)
                        .filter((name) => servicesForm.getValues(name))
                );
                setCurrentPage("producer");
            })}
        >
            {filteredPackages.map((info) => (
                <Controller
                    name={info.name}
                    control={servicesForm.control}
                    render={({ field }) => (
                        <div className="flex items-center space-x-2 py-2">
                            <Checkbox
                                id={`info-${info.name}`}
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                            <Label
                                htmlFor={`info-${info.name}`}
                            >{`${info.name}-${info.version}`}</Label>
                        </div>
                    )}
                />
            ))}
            <Button
                className="mt-4"
                variant="secondary"
                onClick={() => {
                    setCurrentPage("type");
                }}
            >
                Back
            </Button>
            <Button className="mt-4" type="submit">
                Next
            </Button>
        </form>
    );
};
