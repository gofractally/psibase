import dayjs from "dayjs";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import { EmptyBlock } from "@/components/EmptyBlock";
import { useAppForm } from "@/components/form/app-form";

import { useSetSchedule } from "@/hooks/fractals/useSetSchedule";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { zEvalType } from "@/lib/zod/EvaluationType";

export const Proposed = () => {
    const { mutateAsync: setSchedule } = useSetSchedule();

    const fractal = useCurrentFractal();

    const navigate = useNavigate();
    const [showModal, setShowModal] = useQueryState(
        "modal",
        parseAsBoolean.withDefault(false),
    );

    useParams();

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
                    evalType: zEvalType.enum.Repuation,
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    forceDelete: false,
                    fractal: fractal!,
                    intervalSeconds,
                });

                navigate(`/fractal/${fractal}/evaluations`);
                setShowModal(false);
            },
        },
    });

    const values = form.state.values;

    console.log(values, "are the values");

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex justify-between">
                <h1 className="text-lg font-semibold">Proposed</h1>
                <Dialog
                    onOpenChange={(e) => {
                        setShowModal(e);
                    }}
                    open={showModal}
                >
                    <DialogTrigger>
                        <Button
                            size="sm"
                            onClick={() => {
                                setShowModal(true);
                            }}
                        >
                            Schedule
                        </Button>
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
                                        description="When users may register / RSVP for the evaluation, it's recommended to set this 15 minutes prior to evaluation start."
                                    />
                                )}
                            />
                            <form.AppField
                                name="registerSeconds"
                                children={(field) => (
                                    <field.Duration label="Registration duration" />
                                )}
                            />
                            No evaluations scheduled This fractal has no
                            scheduled evaluations.
                            <form.AppField
                                name="deliberationSeconds"
                                children={(field) => (
                                    <field.Duration label="Deliberation duration" />
                                )}
                            />
                            <form.AppField
                                name="submissionSeconds"
                                children={(field) => (
                                    <field.Duration label="Submission duration" />
                                )}
                            />
                            <form.AppField
                                name="intervalSeconds"
                                children={(field) => (
                                    <field.Duration
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
            </div>
            <div className="mt-3">
                <EmptyBlock
                    title="No proposals"
                    buttonLabel="Propose evaluation schedule"
                    description="There are no active proposals."
                    onButtonClick={() => {
                        setShowModal(true);
                    }}
                />
            </div>
        </div>
    );
};
