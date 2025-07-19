import { Button } from "../ui/button";
import { useFormContext } from "./app-form";

type SubmitButtonLabels = [label: string, submittingLabel: string];

export const SubmitButton = ({
    labels = ["Save", "Saving..."],
}: {
    labels?: SubmitButtonLabels;
}) => {
    const form = useFormContext();
    const [label, submittingLabel] = labels;

    return (
        <form.Subscribe
            selector={(state) => [
                state.isValid,
                state.isSubmitting,
                state.isDirty,
            ]}
        >
            {([isValid, isSubmitting, isDirty]) => (
                <Button
                    type="submit"
                    disabled={!isValid || isSubmitting || !isDirty}
                >
                    {isSubmitting ? submittingLabel : label}
                </Button>
            )}
        </form.Subscribe>
    );
};
