import { Input } from "@shared/shadcn/ui/input";

import { useFieldContext } from "./app-form";

export const NumberField = ({ label }: { label: string }) => {
    const field = useFieldContext<number>();

    return (
        <div className="flex flex-col gap-2">
            <div>{label}</div>
            <Input
                value={field.state.value.toString()}
                defaultValue={field.state.value.toString()}
                onChange={(e) => {
                    console.log(e.target.value, "was received?");
                    field.setValue(Number(e.target.value));
                }}
            />
        </div>
    );
};
