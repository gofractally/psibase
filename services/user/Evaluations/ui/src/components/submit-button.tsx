import { useFormContext } from "./app-form";
import { Button } from "@shadcn/button";

type SubmitButtonLabels = [
    label: string,
    submittingLabel: string,
    submittedLabel: string,
];

export const SubmitButton = ({
    submitOnce = false,
    labels = ["Save", "Saving...", "Saved"],
}: {
    submitOnce?: boolean;
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
                state.isPristine,
            ]}
        >
            {([isValid, isSubmitting, isSubmitSuccessful, isPristine]) => {
                return (
                    <Button
                        type="submit"
                        disabled={
                            !isValid ||
                            isSubmitting ||
                            isPristine ||
                            (isSubmitSuccessful && submitOnce)
                        }
                    >
                        {isSubmitting
                            ? submittingLabel
                            : submitOnce && isSubmitSuccessful
                              ? submittedLabel
                              : label}
                    </Button>
                );
            }}
        </form.Subscribe>
    );
};
