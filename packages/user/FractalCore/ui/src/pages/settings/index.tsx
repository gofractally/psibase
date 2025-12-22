import dayjs from "dayjs";
import { useState } from "react";
import { z } from "zod";

import { ScheduleDialog } from "@/components/schedule-dialog";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useSetGuildBio } from "@/hooks/fractals/use-set-guild-bio";
import { useSetGuildDescription } from "@/hooks/fractals/use-set-guild-description";
import { useSetGuildDisplayName } from "@/hooks/fractals/use-set-guild-display-name";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";
import { useNowUnix } from "@/hooks/use-now-unix";

import { useAppForm } from "@shared/components/form/app-form";

import { Leadership } from "./leadership";

export const Settings = () => {
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const now = useNowUnix();
    const status = useEvaluationStatus(now);
    const guildAccount = useGuildAccount();

    const { data: guild, isPending: isGuildPending, refetch } = useGuild();
    const isUpcomingEvaluation = !!guild?.evalInstance;

    const { evaluation } = useEvaluationInstance();

    const { mutateAsync: setGuildBio } = useSetGuildBio();
    const { mutateAsync: setGuildDescription } = useSetGuildDescription();
    const { mutateAsync: setGuildDisplayName } = useSetGuildDisplayName();

    const form = useAppForm({
        defaultValues: {
            displayName: guild?.displayName ?? "",
            bio: guild?.bio ?? "",
            description: guild?.description ?? "",
        },
        onSubmit: async ({
            value: { displayName, bio, description },
            formApi,
        }) => {
            try {
                const promises = [];

                if (!formApi.getFieldMeta("displayName")?.isDefaultValue) {
                    promises.push(
                        setGuildDisplayName([guildAccount!, displayName]),
                    );
                }
                if (!formApi.getFieldMeta("bio")?.isDefaultValue) {
                    promises.push(setGuildBio([guildAccount!, bio]));
                }
                if (!formApi.getFieldMeta("description")?.isDefaultValue) {
                    promises.push(
                        setGuildDescription([guildAccount!, description]),
                    );
                }

                await Promise.all(promises);
            } catch (e) {
                refetch();
                throw e;
            }
        },
        validators: {
            onChange: z.object({
                displayName: z.string().min(1),
                bio: z.string(),
                description: z.string(),
            }),
        },
    });

    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6">
            <div className="flex flex-col gap-3">
                <div className="flex justify-between rounded-sm border p-4 ">
                    <div>
                        <div>Evaluations</div>
                        {!isGuildPending && (
                            <div className="text-muted-foreground text-sm">
                                {isUpcomingEvaluation && evaluation
                                    ? `Next evaluation at ${dayjs.unix(evaluation.registrationStarts).format("MMM, DD")}`
                                    : `No evaluation scheduled`}
                            </div>
                        )}
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

                <div className="flex flex-col gap-2 rounded-sm border p-4 ">
                    <div>
                        <div className="text-xl font-semibold">Metadata</div>
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                    >
                        <div className="my-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <form.AppField
                                name="displayName"
                                children={(field) => (
                                    <field.TextField label="Display name" />
                                )}
                            />
                            <form.AppField
                                name="bio"
                                children={(field) => (
                                    <field.TextField label="Bio" />
                                )}
                            />
                            <div className="col-span-2">
                                <form.AppField
                                    name="description"
                                    children={(field) => (
                                        <field.TextField label="Description" />
                                    )}
                                />
                            </div>
                        </div>
                        <form.AppForm>
                            <form.SubmitButton />
                        </form.AppForm>
                    </form>
                </div>

                <div>
                    <Leadership />
                </div>
            </div>
        </div>
    );
};
