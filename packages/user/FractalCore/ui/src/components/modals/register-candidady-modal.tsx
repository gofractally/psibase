

import { useAppForm } from "@shared/components/form/app-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { useRegisterCandidacy } from "@/hooks/fractals/use-register-candidacy";
import { useGuildMembership } from "@/hooks/fractals/use-guild-membership";
import { zAccount } from "@shared/lib/schemas/account";
import { humanize } from "@/lib/humanize";
import { useNowUnix } from "@/hooks/use-now-unix";
import dayjs from "dayjs";

export const RegisterCandidacyModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: registerCandidacy } = useRegisterCandidacy();

    const { data: membership, refetch } = useGuildMembership();
    const now = useNowUnix();

    const form = useAppForm({
        defaultValues: {
            active: membership?.isCandidate || false
        },
        onSubmit: async ({ formApi, value: { active, } }) => {
            const guildAccount = zAccount.parse(membership?.guild.account);
            await registerCandidacy([guildAccount, active]);
            formApi.reset({ active });
            openChange(false);
            refetch();
        },
    });

    const userWaitSeconds = membership ? Math.abs(dayjs(membership.candidacyEligibleFrom).unix() - now) : 0

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Register candidacy</DialogTitle>
                    {membership && (
                        <div className="text-sm text-muted-foreground space-y-2">
                            <p>
                                By guild policy, disabling candidacy applies a{' '}
                                <span className="font-medium">
                                    {humanize(membership.guild.candidacyCooldown)}
                                </span>{' '}
                                cooldown.
                            </p>
                            {userWaitSeconds > 0 && (
                                <p className="text-orange-300 dark:text-orange-700">
                                    You must wait <span className="font-medium">{humanize(userWaitSeconds)}</span> before re-enabling.
                                </p>
                            )}
                        </div>
                    )}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="active"
                            children={(field) => (
                                <field.SwitchField label="Enable candidacy" disabled={userWaitSeconds > 0} />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                disabled={userWaitSeconds > 0}
                                labels={["Set candidacy", "Setting candidacy"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
