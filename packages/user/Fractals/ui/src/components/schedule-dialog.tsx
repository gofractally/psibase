import dayjs from "dayjs";

import { useSetSchedule } from "@/hooks/fractals/use-set-schedule";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { zEvalType } from "@/lib/zod/EvaluationType";

import { useAppForm } from "@shared/components/form/app-form";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@shared/shadcn/ui/dialog";

interface Props {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    trigger?: React.ReactNode;
    disabled?: boolean;
}

export const ScheduleDialog = ({
    isOpen,
    setIsOpen,
    trigger,
    disabled,
}: Props) => {
    const { mutateAsync: setSchedule } = useSetSchedule();

    const fractal = useCurrentFractal();

    const form = useAppForm({
        defaultValues: {
            register: new Date(),
            registerSeconds: 60 * 15,
            deliberationSeconds: 60 * 45,
            submissionSeconds: 60 * 10,
            intervalSeconds: 86400 * 7,
        },
        validators: {
            onSubmitAsync: async ({
                value: {
                    deliberationSeconds,
                    intervalSeconds,
                    register,
                    registerSeconds,
                    submissionSeconds,
                },
            }) => {
                const registration = dayjs(register).unix();
                const deliberation = registration + registerSeconds;
                const submission = deliberation + deliberationSeconds;
                const finishBy = submission + submissionSeconds;

                await setSchedule({
                    evalType: zEvalType.enum.Reputation,
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    forceDelete: false,
                    fractal: fractal!,
                    intervalSeconds,
                });

                setIsOpen(false);
            },
        },
    });

    return (
        <Dialog
            onOpenChange={(e) => {
                setIsOpen(e);
            }}
            open={isOpen}
        >
            <DialogTrigger asChild>
                {trigger ?? (
                    <Button
                        size="sm"
                        onClick={() => {
                            setIsOpen(true);
                        }}
                        disabled={disabled}
                    >
                        Schedule
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent>
                <DialogTitle>Schedule an evaluation</DialogTitle>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    <form.AppField
                        name="register"
                        children={(field) => (
                            <field.DateTime
                                label="Registration start"
                                description="When users may register/RSVP for the evaluation."
                            />
                        )}
                    />
                    <form.AppField
                        name="registerSeconds"
                        children={(field) => (
                            <field.EvaluationDuration label="Registration duration" />
                        )}
                    />
                    <form.AppField
                        name="deliberationSeconds"
                        children={(field) => (
                            <field.EvaluationDuration label="Deliberation duration" />
                        )}
                    />
                    <form.AppField
                        name="submissionSeconds"
                        children={(field) => (
                            <field.EvaluationDuration label="Submission duration" />
                        )}
                    />
                    <form.AppField
                        name="intervalSeconds"
                        children={(field) => (
                            <field.EvaluationDuration
                                label="Frequency"
                                defaultFrequency="Days"
                            />
                        )}
                    />
                    <form.AppForm>
                        <form.SubmitButton
                            labels={[
                                "Schedule evaluation",
                                "Scheduling evaluation...",
                                "Scheduled evaluation",
                            ]}
                        />
                    </form.AppForm>
                </form>
            </DialogContent>
        </Dialog>
    );
};
