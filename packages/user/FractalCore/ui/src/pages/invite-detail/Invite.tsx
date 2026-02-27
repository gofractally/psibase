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



import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { zAccount } from '@shared/lib/schemas/account'
import { useConnectAccount } from "@/hooks/use-connect-account";
import { useDraftApplication } from "@/hooks/use-draft-application";
import { useAppForm } from "@shared/components/form/app-form";
import { getInvites } from "@/lib/graphql/fractals/getInvites";


dayjs.extend(relativeTime);






export const Invite = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    const {
        data: invite,
        error,
        isLoading,
    } = useQuery({
        enabled: !!token,
        queryKey: ["invite", token],
        queryFn: async () => getInvites(z.string().parse(token)),
    });

    const { mutateAsync: connectAccount } = useConnectAccount();
    const { mutateAsync: draftApplication } = useDraftApplication();

    const form = useAppForm({
        defaultValues: {
            extraInfo: ''
        },
        onSubmit: async ({ value: { extraInfo } }) => {
            const guild = zAccount.parse(invite?.guildInvite?.guild.account);
            await draftApplication([guild, extraInfo])
            await connectAccount(guild)
        }
    })


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
                    <CardDescription>
                        {error.message}
                    </CardDescription>
                    <CardDescription>
                        {error.message}
                    </CardDescription>
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
        const isExpired = vanillaInvite.expiryDate.valueOf() < now || guildInvite == null;
        const expiry = vanillaInvite.expiryDate;

        const inviter = guildInvite?.inviter;

        const description = isExpired
            ? `This invitation expired ${dayjs().to(expiry)} (${dayjs(
                expiry,
            ).format("YYYY/MM/DD HH:mm")}).`
            : `${inviter} has invited you to apply to join the ${guildInvite.guild.displayName} guild in the ${guildInvite.guild.fractal.name} fractal.`;


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
                                form.handleSubmit()
                            }}
                        >
                            <form.AppField
                                name="extraInfo"
                                children={(field) => (<field.TextField
                                    label="Description"
                                />)}
                            />
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Continue", "Loading..."]}
                                />
                            </form.AppForm>
                        </form>
                    </CardContent>
                    <CardFooter className="flex justify-between">
                    </CardFooter>
                </Card>
            );
        }
    }
};
