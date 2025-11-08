import dayjs from "dayjs";

import { useAppForm } from "@/components/form/app-form";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useSetSchedule } from "@/hooks/fractals/use-set-schedule";
import { useGuildAccount } from "@/hooks/use-guild-account";

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
interface FormValues {
    register: Date;
    registerSeconds: number;
    deliberationSeconds: number;
    submissionSeconds: number;
    intervalSeconds: number;
}

const defaultData: FormValues = {
    register: new Date(),
    registerSeconds: 60 * 15,
    deliberationSeconds: 60 * 45,
    submissionSeconds: 60 * 10,
    intervalSeconds: 86400 * 7,
};

export const ScheduleDialog = ({
    isOpen,
    setIsOpen,
    trigger,
    disabled,
}: Props) => {
    const { mutateAsync: setSchedule } = useSetSchedule();

    const fractal = useFractalAccount();
    const guildAccount = useGuildAccount();

    const { evaluation, guild, isPending } = useEvaluationInstance();

    const defaultValues: FormValues = evaluation
        ? {
            intervalSeconds:
                guild?.evalInstance?.interval || defaultData.intervalSeconds,
            register: new Date(evaluation.registrationStarts * 1000),
            deliberationSeconds:
                evaluation.submissionStarts - evaluation.deliberationStarts,
            registerSeconds:
                evaluation.deliberationStarts - evaluation.registrationStarts,
            submissionSeconds:
                evaluation.finishBy - evaluation.submissionStarts,
        }
        : defaultData;

    const form = useAppForm({
        defaultValues,
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
                    guildAccount: guildAccount!,
                    registration,
                    deliberation,
                    submission,
                    finishBy,
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
                        {isPending
                            ? "Loading"
                            : evaluation
                                ? "Update schedule"
                                : "Set new schedule"}
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
