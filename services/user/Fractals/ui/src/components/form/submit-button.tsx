import { Button } from "../ui/button";
import { useFormContext } from "./app-form";

type SubmitButtonLabels = [
    label: string,
    submittingLabel: string,
    submittedLabel: string,
];

export const SubmitButton = ({
    labels = ["Save", "Saving...", "Saved"],
}: {
    labels?: SubmitButtonLabels;
}) => {
    const form = useFormContext();
    const [label, submittingLabel, submittedLabel] = labels;

    return (
        <form.Subscribe
            selector={(state) => [
                state.isValid,
                state.isSubmitting,
                state.isSubmitSuccessful,
            ]}
        >
            {([isValid, isSubmitting, isSubmitSuccessful]) => {
                return (
                    <Button type="submit" disabled={!isValid || isSubmitting}>
                        {isSubmitting
                            ? submittingLabel
                            : isSubmitSuccessful
                              ? submittedLabel
                              : label}
                    </Button>
                );
            }}
        </form.Subscribe>
    );
};
