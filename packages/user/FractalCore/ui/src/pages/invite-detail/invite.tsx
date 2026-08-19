import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
    AlarmClockMinus,
    LoaderCircle,
    TicketCheck,
    TriangleAlert,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { useDraftApplication } from "@/hooks/use-draft-application";
import { getInvites, importToken } from "@/lib/graphql/fractals/get-invites";

import { useAppForm } from "@shared/components/form/app-form";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { zAccount } from "@shared/lib/schemas/account";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { useFractal } from "@/hooks/fractals/use-fractal";

dayjs.extend(relativeTime);

export const Invite = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");


    const { data: fractal } = useFractal();
    const {
        data: invite,
        error,
        isLoading,
    } = useQuery({
        enabled: !!token,
        queryKey: ["invite", token],
        queryFn: async () =>
            importToken(z.string().parse(token)).then(getInvites),
    });

    const { mutateAsync: connectAccount } = useConnectAccount();

    const { mutateAsync: draftApplication } = useDraftApplication();

    const form = useAppForm({
        defaultValues: {
            description: "",
        },
        onSubmit: async ({ value: { description } }) => {
            const guild = zAccount.parse(invite?.guildInvite?.guild.account);
            await draftApplication([guild, description]);
            await connectAccount({
                enabled: true,
                returnPath: `/guild/${guild}/invite-response`,
            });
        },
    });

    if (!token) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Token not found.</CardTitle>
                    <CardDescription>
                        The invitation token is either invalid or does not
                        exist.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    } else if (error) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Error.</CardTitle>
                    <CardDescription>{error.message}</CardDescription>
                </CardHeader>
            </Card>
        );
    } else if (isLoading) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <LoaderCircle className="h-12 w-12 animate-spin" />
                    </div>
                    <CardTitle className="text-center">Loading...</CardTitle>
                </CardHeader>
            </Card>
        );
    } else {
        const { guildInvite, vanillaInvite } = invite!;

        const now = new Date().valueOf();
        const isExpired =
            vanillaInvite.expiryDate.valueOf() < now || guildInvite == null;
        const expiry = vanillaInvite.expiryDate;

        const inviter = guildInvite?.inviter;

        const description = isExpired
            ? `This invitation expired ${dayjs().to(expiry)} (${dayjs(
                expiry,
            ).format("YYYY/MM/DD h:mm A z")}).`
            : `${inviter} has invited you to apply to join the ${guildInvite.guild.displayName} guild in the ${fractal?.fractal?.name} fractal.`;

        if (isExpired) {
            return (
                <Card className="mx-auto mt-4 w-[350px]">
                    <CardHeader>
                        <div className="mx-auto">
                            <AlarmClockMinus className="h-12 w-12" />
                        </div>
                        <CardTitle>Expired invitation</CardTitle>
                        <CardDescription>{description}</CardDescription>
                        <CardDescription>
                            Please ask the sender{" "}
                            <span className="text-primary">{inviter}</span> for
                            a new one.
                        </CardDescription>
                    </CardHeader>
                </Card>
            );
        } else {
            return (
                <Card className="mx-auto mt-4 w-[350px]">
                    <CardHeader>
                        <div className="mx-auto">
                            <TicketCheck className="h-12 w-12" />
                        </div>
                        <CardTitle>{`Apply to join the ${guildInvite.guild.displayName} guild.`}</CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                form.handleSubmit();
                            }}
                            className="flex flex-col gap-2"
                        >
                            <form.AppField
                                name="description"
                                children={(field) => (
                                    <field.TextArea label="What additional information would you like to include with your application?" />
                                )}
                            />
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Continue", "Loading..."]}
                                />
                            </form.AppForm>
                        </form>
                    </CardContent>
                    <CardFooter className="flex justify-between"></CardFooter>
                </Card>
            );
        }
    }
};
