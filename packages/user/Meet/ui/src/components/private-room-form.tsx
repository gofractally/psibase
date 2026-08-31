import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { meetPlugin } from "@/hooks/use-plugin";
import { getMeeting } from "@/lib/graphql";
import {
    parseSetMeetingResult,
    storeMeetingPassword,
} from "@/lib/meeting-password";
import { createRoomId } from "@/lib/room-id";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

const uniqueMeetingId = async () => {
    for (let i = 0; i < 8; i++) {
        const id = createRoomId();
        try {
            if (await getMeeting(id)) continue;
        } catch {
            // If the query fails, still use this generated id.
        }
        return id;
    }
    throw new Error("Could not generate a free meeting name");
};

export const PrivateRoomForm = ({
    persistName,
}: {
    persistName: () => void;
}) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const form = useAppForm({
        defaultValues: {
            meetingId: "",
            invitees: [{ account: "" }] as Array<{ account: string }>,
        },
        validators: {
            onChange: z.object({
                meetingId: zAccount.or(z.literal("")),
                invitees: z.array(z.object({ account: z.string() })),
            }),
        },
        onSubmit: async ({ value }) => {
            try {
                const name = value.meetingId.trim().toLowerCase();
                const id = name
                    ? zAccount.parse(name)
                    : await uniqueMeetingId();
                const accounts = value.invitees
                    .map((invitee) => invitee.account.trim().toLowerCase())
                    .filter(Boolean);
                const result = parseSetMeetingResult(
                    await meetPlugin.setMeeting(id, accounts),
                );
                storeMeetingPassword(id, result.hash, result.password);
                persistName();
                void queryClient.invalidateQueries({ queryKey: ["meet"] });
                navigate(`/private/${id}`);
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : "Could not create the meeting",
                );
                throw error;
            }
        },
    });

    return (
        <form.AppForm>
            <form
                className="space-y-3"
                autoComplete="off"
                onSubmit={(event) => {
                    event.preventDefault();
                    const filled = form
                        .getFieldValue("invitees")
                        .filter((invitee) => invitee.account.trim().length > 0);
                    form.setFieldValue("invitees", filled);
                    void form.handleSubmit();
                }}
            >
                <form.AppField
                    name="invitees"
                    mode="array"
                    children={(field) => (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">
                                Invite accounts
                            </p>
                            {field.state.value.map((_, index) => (
                                <div
                                    key={index}
                                    className="flex items-start gap-2"
                                >
                                    <div className="min-w-0 flex-1">
                                        <FieldAccountExisting
                                            form={form}
                                            fields={`invitees[${index}]`}
                                            label={undefined}
                                            description={undefined}
                                            placeholder="alice"
                                            disabled={false}
                                            onValidate={undefined}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-lg"
                                        onClick={() =>
                                            field.removeValue(index)
                                        }
                                        aria-label="Remove account"
                                    >
                                        <Trash />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    field.pushValue({ account: "" })
                                }
                            >
                                <Plus />
                                Add account
                            </Button>
                        </div>
                    )}
                />
                <form.AppField
                    name="meetingId"
                    validators={{
                        onSubmit: zAccount.or(z.literal("")),
                    }}
                    children={(field) => (
                        <field.TextField
                            label="Meeting name"
                            placeholder="Optional"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            description="Leave blank to generate a name. If it already exists, only its host can update it."
                        />
                    )}
                />
                <form.SubmitButton
                    labels={["Set private room", "Saving…"]}
                />
            </form>
        </form.AppForm>
    );
};
