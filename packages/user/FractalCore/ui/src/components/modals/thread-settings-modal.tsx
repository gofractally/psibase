import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { usePluginFunctionCallMutation } from "@/hooks/use-plugin-function-call-mutation";
import { formatRawAmount } from "@/lib/format-token";
import {
    getFee,
    getFeeCurve,
    getOpenToPublic,
    social,
    type FeeCurve,
    type SocialThread,
} from "@/lib/social";

import { useAppForm } from "@shared/components/form/app-form";
import type { DurationUnit } from "@shared/lib/schemas/duration-unit";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

const U32_MAX = 4_294_967_295;

const bidUnit = (seconds: number): DurationUnit => {
    if (seconds > 0 && seconds % 86_400 === 0) return "Days";
    if (seconds > 0 && seconds % 3_600 === 0) return "Hours";
    return "Minutes";
};

/** Token amounts use precision 4. `1.5` is 15000 raw units. */
const decimalToRaw = (value: string): bigint | null => {
    const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
    if (!match) return null;
    const fraction = (match[2] ?? "").padEnd(4, "0");
    return BigInt(`${match[1]}${fraction}`);
};

const zSettings = (feeRequired: boolean) =>
    z.object({
        bidSeconds: z.number().refine((seconds) => {
            const rounded = Math.round(seconds);
            return rounded >= 1 && rounded <= U32_MAX;
        }, "Bidding window must be greater than 0"),
        fee: z.string().refine((value) => {
            if (!feeRequired) return true;
            return decimalToRaw(value) !== null;
        }, "Enter an amount with up to 4 decimal places"),
        isPublic: z.boolean(),
    });

const SettingsForm = ({
    fractal,
    thread,
    curve,
    curveError,
    currentFee,
    allowsPublic,
    onSaved,
    onClose,
}: {
    fractal: string;
    thread: SocialThread;
    curve: FeeCurve | null;
    curveError: string | null;
    currentFee: string | undefined;
    allowsPublic: boolean;
    onSaved: () => void;
    onClose: () => void;
}) => {
    const setPublic = usePluginFunctionCallMutation(social.setPublic, {
        toast: {
            loading: "Updating privacy",
            success: "Privacy updated",
            error: "Couldn't update privacy",
        },
    });
    const setBidSecs = usePluginFunctionCallMutation(social.setBidSecs, {
        toast: {
            loading: "Updating bidding window",
            success: "Bidding window updated",
            error: "Couldn't update the bidding window",
        },
    });
    const setFee = usePluginFunctionCallMutation(social.setFee, {
        toast: {
            loading: "Updating posting fee",
            success: "Posting fee updated",
            error: "Couldn't update the posting fee",
        },
    });

    const currentFeeText =
        currentFee == null
            ? "Minimum charged to post."
            : `Minimum charged to post. The current fee is ${formatRawAmount(currentFee)}. A higher minimum applies immediately.`;

    const form = useAppForm({
        defaultValues: {
            bidSeconds: thread.bidSeconds,
            fee: curve ? formatRawAmount(curve.floor) : "",
            isPublic: thread.public,
        },
        validators: {
            onChange: zSettings(curve != null),
        },
        onSubmit: async ({ value }) => {
            const seconds = Math.round(value.bidSeconds);
            const asAccount = thread.creator;
            if (value.isPublic !== thread.public) {
                await setPublic.mutateAsync([
                    asAccount,
                    fractal,
                    thread.account,
                    value.isPublic,
                ]);
            }
            if (seconds !== thread.bidSeconds) {
                await setBidSecs.mutateAsync([
                    asAccount,
                    fractal,
                    thread.account,
                    seconds,
                ]);
            }
            const floor = decimalToRaw(value.fee);
            if (curve && floor !== null && floor !== BigInt(curve.floor)) {
                await setFee.mutateAsync([
                    asAccount,
                    fractal,
                    thread.account,
                    curve.windowSeconds,
                    curve.targetMin,
                    curve.targetMax,
                    floor,
                    curve.increasePpm,
                    curve.decreasePpm,
                ]);
            }
            onSaved();
            onClose();
        },
    });

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit();
            }}
            className="mt-3 w-full space-y-6"
        >
            <form.AppField
                name="bidSeconds"
                children={(field) => (
                    <>
                        <field.DurationSelectField
                            label="Bidding window"
                            defaultFrequency={bidUnit(thread.bidSeconds)}
                        />
                        <p className="text-muted-foreground text-sm">
                            How long bidding stays open after a post.
                        </p>
                    </>
                )}
            />
            <form.AppField
                name="fee"
                children={(field) => (
                    <field.TextField
                        label="Posting fee"
                        inputMode="decimal"
                        disabled={curve == null}
                        description={
                            curve
                                ? currentFeeText
                                : (curveError ??
                                  "The posting fee couldn't be loaded.")
                        }
                    />
                )}
            />
            <form.AppField
                name="isPublic"
                children={(field) => (
                    <field.SwitchField
                        label="Public"
                        disabled={!allowsPublic}
                        description={
                            allowsPublic
                                ? "Off is private, visible to fractal members. On also lets outsiders see it when this fractal allows public threads."
                                : "This fractal does not allow public threads."
                        }
                    />
                )}
            />
            <form.AppForm>
                <form.SubmitButton labels={["Save", "Saving..."]} />
            </form.AppForm>
        </form>
    );
};

export const ThreadSettingsModal = ({
    show,
    openChange,
    fractal,
    thread,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    fractal: string;
    thread: SocialThread;
}) => {
    const queryClient = useQueryClient();
    const curve = useQuery({
        queryKey: ["social-fee-curve", fractal, thread.account],
        enabled: show,
        queryFn: () => getFeeCurve(fractal, thread.account),
    });
    const fee = useQuery({
        queryKey: ["social-fee", fractal, thread.account],
        enabled: show,
        queryFn: () => getFee(fractal, thread.account),
    });
    const openToPublic = useQuery({
        queryKey: ["social-open", fractal],
        enabled: show && Boolean(fractal),
        queryFn: () => getOpenToPublic(fractal),
    });

    const onSaved = () => {
        void queryClient.invalidateQueries({
            queryKey: ["social-threads", fractal],
        });
        void queryClient.invalidateQueries({
            queryKey: ["social-fee", fractal, thread.account],
        });
        void queryClient.invalidateQueries({
            queryKey: ["social-fee-curve", fractal, thread.account],
        });
        void queryClient.invalidateQueries({
            queryKey: ["social-ranked", fractal],
        });
    };

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Thread settings</DialogTitle>
                    {show && curve.isFetched && openToPublic.isFetched ? (
                        <SettingsForm
                            key={`${thread.account}-${thread.bidSeconds}-${thread.public}-${curve.data?.floor ?? "none"}-${openToPublic.data === true}`}
                            fractal={fractal}
                            thread={thread}
                            curve={curve.data ?? null}
                            curveError={curve.error?.message ?? null}
                            currentFee={fee.data}
                            allowsPublic={openToPublic.data === true}
                            onSaved={onSaved}
                            onClose={() => openChange(false)}
                        />
                    ) : (
                        show && (
                            <p className="text-muted-foreground mt-3 text-sm">
                                Loading settings…
                            </p>
                        )
                    )}
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
