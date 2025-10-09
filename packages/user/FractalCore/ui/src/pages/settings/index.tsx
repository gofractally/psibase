import { useAppForm } from "@/components/form/app-form";
import { ScheduleDialog } from "@/components/schedule-dialog"
import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useSetGuildBio } from "@/hooks/fractals/use-set-guild-bio";
import { useSetGuildDescription } from "@/hooks/fractals/use-set-guild-description";
import { useSetGuildDisplayName } from "@/hooks/fractals/use-set-guild-display-name";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-id";
import { useNowUnix } from "@/hooks/use-now-unix";
import dayjs from "dayjs";
import { useState } from "react";
import { z } from "zod";


export const Settings = () => {
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const now = useNowUnix();

    const status = useEvaluationStatus(now);
    const guildAccount = useGuildAccount()

    const { data: guild, isPending: isGuildPending } = useGuild();

    const isUpcomingEvaluation = !!guild?.evalInstance;

    const { evaluation } = useEvaluationInstance();
    const { mutateAsync: setGuildBio } = useSetGuildBio()
    const { mutateAsync: setGuildDescription } = useSetGuildDescription()
    const { mutateAsync: setGuildDisplayName } = useSetGuildDisplayName()


    const displayNameForm = useAppForm({
        defaultValues: {
            displayName: guild?.displayName ?? ''
        },
        onSubmit: async ({ value: { displayName } }) => {
            await setGuildDisplayName({ displayName, guildAccount: guildAccount! })
        },
        validators: {
            onChange: z.object({
                displayName: z.string().min(1)
            })
        }
    });

    const bioForm = useAppForm({
        defaultValues: {
            bio: guild?.bio ?? ''
        },
        onSubmit: async ({ value: { bio } }) => {
            await setGuildBio({ bio, guildAccount: guildAccount! })
        },
        validators: {
            onChange: z.object({
                bio: z.string()
            })
        }
    });

    const descriptonForm = useAppForm({
        defaultValues: {
            description: guild?.description ?? ''
        },
        onSubmit: async ({ value: { description } }) => {
            await setGuildDescription({ description, guildAccount: guildAccount! })
        },
        validators: {
            onChange: z.object({
                description: z.string()
            })
        }
    });


    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">

        <div className="flex flex-col gap-3">



            <div className="border flex justify-between rounded-sm p-4 ">
                <div>
                    <div>Evaluations</div>
                    {!isGuildPending && <div className="text-sm text-muted-foreground">
                        {isUpcomingEvaluation && evaluation ? `Next evaluation at ${dayjs.unix(evaluation.registrationStarts).format('MMM, DD')}` : `No evaluation scheduled`}
                    </div>}
                </div>
                <div>
                    <ScheduleDialog
                        isOpen={isScheduleDialogOpen}
                        setIsOpen={setIsScheduleDialogOpen}
                        disabled={
                            status?.type &&
                            status?.type !== "waitingRegistration"
                        }
                    />

                </div>

            </div>

            <div className="border rounded-sm p-4 flex flex-col gap-2 ">
                <div>
                    <div className="text-xl font-semibold">Metadata</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                    <form onSubmit={(e) => {
                        e.preventDefault()
                        void displayNameForm.handleSubmit();
                    }}>

                        <displayNameForm.AppField
                            name="displayName"
                            children={(field) =>
                                (<field.TextField label="Display name" />)
                            }
                        />
                        <displayNameForm.AppForm>
                            <displayNameForm.SubmitButton />
                        </displayNameForm.AppForm>
                    </form>

                    <form onSubmit={(e) => {
                        e.preventDefault()
                        void bioForm.handleSubmit();
                    }}>
                        <bioForm.AppField
                            name="bio"
                            children={(field) =>
                                (<field.TextField label="Bio" />)
                            }
                        />
                        <bioForm.AppForm>
                            <bioForm.SubmitButton />
                        </bioForm.AppForm>
                    </form>

                    <form className="col-span-2" onSubmit={(e) => {
                        e.preventDefault()
                        void descriptonForm.handleSubmit();
                    }}>
                        <descriptonForm.AppField
                            name="description"
                            children={(field) =>
                                (<field.TextField label="Description" />)
                            }
                        />
                        <descriptonForm.AppForm>
                            <descriptonForm.SubmitButton />
                        </descriptonForm.AppForm>
                    </form>

                </div>

            </div>

        </div>
    </div>
}