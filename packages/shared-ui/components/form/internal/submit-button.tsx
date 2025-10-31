import { Button } from "@shared/shadcn/ui/button";

import { useFormContext } from "../app-form";

type SubmitButtonLabels = [label: string, submittingLabel: string];

export const SubmitButton = ({
    labels = ["Save", "Saving..."],
    onClick,
    disabled,
}: {
    labels?: SubmitButtonLabels;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
}) => {
    const form = useFormContext();
    const [label, submittingLabel] = labels;

    return (
        <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting]}
        >
            {([canSubmit, isSubmitting]) => {
                return (
                    <Button
                        type="submit"
                        disabled={!canSubmit || isSubmitting || disabled}
                        onClick={onClick}
                    >
                        {isSubmitting ? submittingLabel : label}
                    </Button>
                );
            }}
        </form.Subscribe>
    );
};
