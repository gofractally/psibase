import { useFieldContext } from "./app-form";
import { Input } from "@shared/shadcn/ui/input";

export const NumberField = ({ label }: { label: string }) => {
    const field = useFieldContext<number>();

    return (
        <div className="flex flex-col gap-2">
            <div>{label}</div>
            <Input
                className="w-8"
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
