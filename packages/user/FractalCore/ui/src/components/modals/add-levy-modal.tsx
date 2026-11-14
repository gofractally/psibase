import { useEffect, type ReactNode } from "react";
import { z } from "zod";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useHasRewardStream } from "@/hooks/fractals/use-has-reward-stream";
import { hasRewardStream } from "@/lib/graphql/fractals/has-reward-stream";
import { useLevies } from "@/hooks/fractals/use-levies";
import { useAddLevy } from "@/hooks/fractals/use-levy";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import {
    PPM,
    percentToPpm,
    ppmToPercent,
    zPercent,
} from "@shared/lib/percent-ppm";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { toast } from "@shared/shadcn/ui/sonner";

const usedPpm = (
    levies: { member: string; ratePpm: number }[] | undefined,
    member: string,
) =>
    (levies ?? [])
        .filter((levy) => levy.member === member)
        .reduce((total, levy) => total + levy.ratePpm, 0);

const StreamPayout = ({
    fractal,
    payee,
    field,
}: {
    fractal: string | null | undefined;
    payee: string;
    field: {
        state: { value: boolean };
        handleChange: (value: boolean) => void;
        CheckboxField: (props: {
            label: string;
            description?: string;
            disabled?: boolean;
        }) => ReactNode;
    };
}) => {
    const known = zAccount.safeParse(payee).success ? payee : undefined;
    const { data: hasStream, isFetching } = useHasRewardStream(fractal, known);
    const blocked = known !== undefined && hasStream === false;

    const checked = field.state.value;
    const clear = field.handleChange;
    useEffect(() => {
        if (blocked && checked) clear(false);
    }, [blocked, checked, clear]);

    return (
        <field.CheckboxField
            label="Pay into their reward stream"
            description={
                blocked
                    ? "They have no reward stream. This would abort their claims."
                    : isFetching
                      ? "Checking their reward stream..."
                      : "Only if they already have one."
            }
            disabled={blocked}
        />
    );
};

/** Empty or 0 means the levy does not end. Anything else is a token amount. */
const zDebt = z
    .string()
    .refine(
        (value) => value.trim() === "" || /^\d+(\.\d+)?$/.test(value.trim()),
        "Enter a number, or 0 if it does not end",
    );

export const AddLevyModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const fractalAccount = useFractalAccount();
    const { data: levies, isLoading, isError } = useLevies(fractalAccount);
    const { mutateAsync: addLevy } = useAddLevy();

    const form = useAppForm({
        defaultValues: {
            levy: {
                member: "",
                payee: "",
                percent: "5",
                debt: "0",
                // Off until the payee is known to have a stream. The chain rejects it otherwise.
                sendToStream: false,
            },
        },
        onSubmit: async ({
            formApi,
            value: {
                levy: { member, payee, percent, debt, sendToStream },
            },
        }) => {
            const used = usedPpm(levies, member);
            const ratePpm = percentToPpm(percent);
            if (isLoading || isError || !levies || ratePpm === null) {
                toast.error("Existing levies are not loaded yet");
                return;
            }
            if (ratePpm + used > PPM) {
                toast.error(
                    used >= PPM
                        ? "This account is already at 100%"
                        : `Only ${ppmToPercent(PPM - used)}% left on this account`,
                );
                return;
            }
            if (
                sendToStream &&
                (!fractalAccount ||
                    !(await hasRewardStream(fractalAccount, payee)))
            ) {
                toast.error("That account has no reward stream");
                return;
            }
            await addLevy([member, payee, ratePpm, debt, sendToStream]);
            openChange(false);
            formApi.reset();
        },
        validators: {
            onChange: z.object({
                levy: z.object({
                    member: zAccount,
                    payee: zAccount,
                    percent: zPercent,
                    debt: zDebt,
                    sendToStream: z.boolean(),
                }),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Post a levy</DialogTitle>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <FieldAccountExisting
                            form={form}
                            fields={{ account: "levy.member" }}
                            label="Charged account"
                            description="Must have a reward stream."
                            placeholder="Account being charged"
                            disabled={false}
                            supervisor={supervisor}
                        />
                        <FieldAccountExisting
                            form={form}
                            fields={{ account: "levy.payee" }}
                            label="Paid account"
                            description={undefined}
                            placeholder="Account that receives the cut"
                            disabled={false}
                            supervisor={supervisor}
                        />
                        <form.Subscribe
                            selector={(state) => state.values.levy.member}
                        >
                            {(member) => {
                                const used = usedPpm(levies, member);
                                const description = !member
                                    ? "Share of each claim."
                                    : isLoading
                                      ? "Checking existing levies..."
                                      : used >= PPM
                                        ? "This account is already at 100%."
                                        : `${ppmToPercent(PPM - used)}% left on this account.`;
                                return (
                                    <form.AppField
                                        name="levy.percent"
                                        children={(field) => (
                                            <field.PercentField
                                                label="Rate"
                                                description={description}
                                            />
                                        )}
                                    />
                                );
                            }}
                        </form.Subscribe>
                        <form.AppField
                            name="levy.debt"
                            children={(field) => (
                                <field.TextField
                                    label="Remaining debt"
                                    description="0 does not end. Anything else stops when it is paid."
                                />
                            )}
                        />
                        <form.Subscribe selector={(state) => state.values.levy.payee}>
                            {(payee) => (
                                <form.AppField
                                    name="levy.sendToStream"
                                    children={(field) => (
                                        <StreamPayout
                                            fractal={fractalAccount}
                                            payee={payee}
                                            field={field}
                                        />
                                    )}
                                />
                            )}
                        </form.Subscribe>
                        <form.AppForm>
                            <form.SubmitButton
                                disabled={isLoading || isError}
                                labels={["Post levy", "Posting"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
