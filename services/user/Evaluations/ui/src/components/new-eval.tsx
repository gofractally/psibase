import { humanize } from "@/lib/humanize";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

import { useCreateEvaluation } from "@/hooks/app/use-create-evaluation";

import { useAppForm } from "./app-form";
import { NumbersField } from "./numbers-field";

dayjs.extend(duration);

export const NewEval = ({ onSubmit }: { onSubmit: () => void }) => {
    const { mutateAsync: createEvaluation } = useCreateEvaluation();

    const form = useAppForm({
        defaultValues: {
            registration: new Date(),
            deliberationSeconds: 120,
            submissionSeconds: 120,
            finishBySeconds: 120,
            allowableGroupSizes: [4, 5, 6],
            numOptions: 6,
        },
        validators: {
            onSubmitAsync: async (data) => {
                const {
                    registration,
                    deliberationSeconds,
                    submissionSeconds,
                    finishBySeconds,
                    allowableGroupSizes,
                    numOptions,
                } = data.value;

                const registrationUnix = dayjs(registration).unix();
                const deliberation = registrationUnix + deliberationSeconds;
                const submission = deliberation + submissionSeconds;
                const finishBy = submission + finishBySeconds;

                const pars = {
                    registration: registrationUnix,
                    deliberation,
                    submission,
                    finishBy,
                    allowableGroupSizes,
                    numOptions,
                    useHooks: false,
                };

                console.log({
                    registrationUnix,
                    deliberation,
                    submission,
                    finishBy,
                    pars,
                });
                try {
                    await createEvaluation(pars);
                } catch (error) {
                    console.error(error);
                    return "Failed to create evaluation";
                }
            },
        },
        onSubmit: () => {
            onSubmit();
            form.reset();
        },
    });

    const now = dayjs();

    return (
        <div>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void form.handleSubmit();
                }}
            >
                <form.AppField
                    name="registration"
                    children={(field) => (
                        <field.DateTimeField
                            label="Registration starts from"
                            description={
                                dayjs(field.state.value).isBefore(now)
                                    ? "Now"
                                    : humanize(
                                          dayjs(field.state.value).diff(now),
                                      )
                            }
                        />
                    )}
                />
                <form.AppField
                    name="deliberationSeconds"
                    children={(field) => (
                        <field.DurationField
                            label="Registration duration"
                        />
                    )}
                />
                <form.AppField
                    name="submissionSeconds"
                    children={(field) => (
                        <field.DurationField
                            label="Deliberation duration"
                        />
                    )}
                />
                <form.AppField
                    name="finishBySeconds"
                    children={(field) => (
                        <field.DurationField
                            label="Submission duration"
                        />
                    )}
                />
                <form.AppField
                    name="allowableGroupSizes"
                    children={() => (
                        <NumbersField label="Allowable Group Sizes" />
                    )}
                />
                <form.AppField
                    name="numOptions"
                    validators={{
                        onChange: ({ value }) => {
                            if (value < 2 || value > 255) {
                                return "Number of options must be between 2 and 255";
                            }
                        },
                    }}
                    children={(field) => (
                        <field.NumberField label="Number of options" />
                    )}
                />
                <div className="flex py-2">
                    <form.AppForm>
                        <form.SubmitButton
                            submitOnce
                            labels={[
                                "Create Evaluation",
                                "Creating Evaluation...",
                                "Created evaluation",
                            ]}
                        />
                    </form.AppForm>
                </div>
            </form>
        </div>
    );
};
