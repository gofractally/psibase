import { useCreateEvaluation } from "@hooks/app/use-create-evaluation";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { useAppForm } from "./app-form";
import { humanize } from "@lib/humanize";
import { NumbersField } from "./numbers-field";

dayjs.extend(duration);

const lowestFifth = (minute: number) => minute - (minute % 5);

const now = dayjs();

const registration = now;
const deliberation = now.add(30, "seconds");
const submission = deliberation.add(20, "seconds");
const finishBy = submission.add(60, "minutes");

export const NewEval = ({ onSubmit }: { onSubmit: () => void }) => {
    const { mutateAsync: createEvaluation } = useCreateEvaluation();

    const form = useAppForm({
        defaultValues: {
            registration: registration.toDate(),
            deliberation: deliberation.toDate(),
            submission: submission.toDate(),
            finishBy: finishBy.toDate(),
            allowableGroupSizes: [1, 2, 3, 4, 5, 6],
            rankAmount: 6,
        },
        validators: {
            onSubmit: (data) => {
                const now = dayjs();
                const { deliberation } = data.value;

                if (now.valueOf() > deliberation.valueOf()) {
                    return "Deliberation phase has already started";
                }
            },
            onSubmitAsync: async (data) => {
                const {
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    allowableGroupSizes,
                    rankAmount,
                } = data.value;

                try {
                    await createEvaluation({
                        deliberation: dayjs(deliberation).unix(),
                        finishBy: dayjs(finishBy).unix(),
                        registration: dayjs(registration).unix(),
                        submission: dayjs(submission).unix(),
                        allowableGroupSizes,
                        rankAmount,
                        useHooks: false,
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
                            label="Registration phase"
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

                            if (new Date().valueOf() > deliberation.valueOf()) {
                                return "Deliberation phase has already started";
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
                            label="Deliberation phase"
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
                            label="Submission phase"
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
                            label="Finish by"
                            description={humanize(
                                dayjs(field.state.value).diff(
                                    dayjs(form.getFieldValue("submission")),
                                ),
                            )}
                        />
                    )}
                />
                <form.AppField
                    name="allowableGroupSizes"
                    children={(field) => (
                        <NumbersField label="Allowable Group Sizes" />
                    )}
                />
                <form.AppField
                    name="rankAmount"
                    validators={{
                        onChange: ({ value }) => {
                            if (value < 2 || value > 255) {
                                return "Rank amount must be between 2 and 255";
                            }
                        },
                    }}
                    children={(field) => (
                        <field.NumberField label="Rank Amount" />
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
