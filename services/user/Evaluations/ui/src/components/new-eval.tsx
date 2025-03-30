import { useCreateEvaluation } from "@hooks/use-create-evaluation";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { useAppForm } from "./app-form";
import { humanize } from "@lib/humanize";

dayjs.extend(duration);

const lowestFifth = (minute: number) => minute - (minute % 5);

const now = dayjs();

const registration = now
    .set("minute", lowestFifth(dayjs().minute()))
    .set("second", 0);
const deliberation = now.add(1, "minutes").set("second", 0);
const submission = deliberation.add(1, "minutes");
const finishBy = submission.add(1, "minutes");

export const NewEval = ({ onSubmit }: { onSubmit: () => void }) => {
    const { mutateAsync: createEvaluation } = useCreateEvaluation();

    const form = useAppForm({
        defaultValues: {
            registration: registration.toDate(),
            deliberation: deliberation.toDate(),
            submission: submission.toDate(),
            finishBy: finishBy.toDate(),
        },
        validators: {
            onSubmitAsync: async (data) => {
                const { registration, deliberation, submission, finishBy } =
                    data.value;

                try {
                    await createEvaluation({
                        deliberation: dayjs(deliberation).unix(),
                        finishBy: dayjs(finishBy).unix(),
                        registration: dayjs(registration).unix(),
                        submission: dayjs(submission).unix(),
                        allowableGroupSizes: [4, 5, 6],
                    });
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

    console.log(form.state.errors, "are form errors");

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
                    listeners={{
                        onChange: ({ value }) => {
                            if (value > form.getFieldValue("deliberation")) {
                                form.setFieldValue(
                                    "deliberation",
                                    dayjs(value).add(1, "hour").toDate(),
                                );
                            }
                        },
                    }}
                    children={(field) => (
                        <field.DateTimeField
                            label="Registration"
                            description={
                                dayjs(field.state.value).isBefore(now)
                                    ? "Now"
                                    : "In " +
                                      humanize(
                                          dayjs(field.state.value).diff(now),
                                      )
                            }
                        />
                    )}
                />
                <form.AppField
                    name="deliberation"
                    validators={{
                        onChange: ({ value, fieldApi }) => {
                            if (
                                value <
                                fieldApi.form.getFieldValue("registration")
                            ) {
                                return "Deliberation must be after registration";
                            }
                        },
                    }}
                    listeners={{
                        onChange: ({ value }) => {
                            if (value > form.getFieldValue("submission")) {
                                form.setFieldValue(
                                    "submission",
                                    dayjs(value).add(1, "hour").toDate(),
                                );
                            }
                        },
                    }}
                    children={(field) => (
                        <field.DateTimeField
                            label="Deliberation"
                            description={humanize(
                                dayjs(field.state.value).diff(
                                    dayjs(form.getFieldValue("registration")),
                                ),
                            )}
                        />
                    )}
                />
                <form.AppField
                    name="submission"
                    listeners={{
                        onChange: ({ value }) => {
                            if (value > form.getFieldValue("finishBy")) {
                                form.setFieldValue(
                                    "finishBy",
                                    dayjs(value).add(1, "hour").toDate(),
                                );
                            }
                        },
                    }}
                    children={(field) => (
                        <field.DateTimeField
                            label="Submission"
                            description={humanize(
                                dayjs(field.state.value).diff(
                                    dayjs(form.getFieldValue("deliberation")),
                                ),
                            )}
                        />
                    )}
                />
                <form.AppField
                    name="finishBy"
                    validators={{
                        onChange: ({ value, fieldApi }) => {
                            if (
                                value <
                                fieldApi.form.getFieldValue("submission")
                            ) {
                                return "Finish by must be after submission";
                            }
                        },
                    }}
                    children={(field) => (
                        <field.DateTimeField
                            label="Finish By"
                            description={humanize(
                                dayjs(field.state.value).diff(
                                    dayjs(form.getFieldValue("submission")),
                                ),
                            )}
                        />
                    )}
                />
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
            </form>
        </div>
    );
};
