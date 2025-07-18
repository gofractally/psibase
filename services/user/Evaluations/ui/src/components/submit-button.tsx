import { Button } from "@shared/shadcn/ui/button";

import { useFormContext } from "./app-form";

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
            ]}
        >
            {([isValid, isSubmitting, isSubmitSuccessful]) => {
                return (
                    <Button
                        type="submit"
                        disabled={
                            !isValid ||
                            isSubmitting ||
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
