import { Button } from "@shared/shadcn/ui/button";

import { useFormContext } from "../app-form";

type SubmitButtonLabels = [
    label: string,
    submittingLabel: string,
    submittedLabel: string,
];

export const SubmitButton = ({
    labels = ["Save", "Saving...", "Saved"],
    onClick,
}: {
    labels?: SubmitButtonLabels;
    onClick?: () => void;
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
                        type={onClick ? "button" : "submit"}
                        disabled={!isValid || isSubmitting}
                        onClick={onClick}
                    >
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
