import { Button } from "@shared/shadcn/ui/button";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { useFormContext } from "../app-form";

type SubmitButtonLabels = [label: string, submittingLabel: string];

export const SubmitButton = ({
    labels = ["Save", "Saving..."],
    onClick,
    disabled,
    loading,
}: {
    labels?: SubmitButtonLabels;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    loading?: boolean;
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
                        disabled={
                            !canSubmit || isSubmitting || loading || disabled
                        }
                        onClick={onClick}
                    >
                        {loading || isSubmitting ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {isSubmitting ? submittingLabel : label}
                    </Button>
                );
            }}
        </form.Subscribe>
    );
};
