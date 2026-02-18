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

import { useAppForm } from "@shared/components/form/app-form";
import { GlowingCard } from "@shared/components/glowing-card";
import { useNowUnix } from "@shared/hooks/use-now-unix";
import {
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

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
        <div className="mx-auto w-full max-w-5xl space-y-6 p-4 px-6">
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Metadata</CardTitle>
                </CardHeader>
                <form.AppForm>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="flex flex-col gap-6"
                    >
                        <CardContent className="flex flex-col gap-4">
                            <div className="max-w-3xs">
                                <form.AppField
                                    name="displayName"
                                    children={(field) => (
                                        <field.TextField label="Guild name" />
                                    )}
                                />
                            </div>
                            <form.AppField
                                name="bio"
                                children={(field) => (
                                    <field.TextField label="Description" />
                                )}
                            />
                            <form.AppField
                                name="description"
                                children={(field) => (
                                    <field.TextField label="Mission" />
                                )}
                            />
                        </CardContent>
                        <CardFooter className="justify-end">
                            <form.SubmitButton />
                        </CardFooter>
                    </form>
                </form.AppForm>
            </GlowingCard>
            {!isGuildPending && (
                <GlowingCard>
                    <CardHeader>
                        <CardTitle>Scheduling</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Item variant="muted">
                            <ItemContent>
                                <ItemTitle>Evaluations schedule</ItemTitle>
                                <ItemDescription>
                                    {isUpcomingEvaluation && evaluation
                                        ? `Next evaluation at ${dayjs.unix(evaluation.registrationStarts).format("MMM, DD")}`
                                        : `No evaluation scheduled`}
                                </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <ScheduleDialog
                                    isOpen={isScheduleDialogOpen}
                                    setIsOpen={setIsScheduleDialogOpen}
                                    disabled={
                                        status?.type &&
                                        status?.type !== "waitingRegistration"
                                    }
                                />
                            </ItemActions>
                        </Item>
                    </CardContent>
                </GlowingCard>
            )}
        </div>
    );
};
