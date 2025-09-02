import { useAppForm } from "@/form/app-form";
import NumberFlow from "@number-flow/react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { ErrorCard } from "@/components/error-card";

import { useCurrentUser } from "@/hooks";
import { useClaim } from "@/hooks/use-claim";
import { useDeposit } from "@/hooks/use-deposit";
import { useNft } from "@/hooks/use-nft";
import { useStream } from "@/hooks/use-stream";
import { useToken } from "@/hooks/use-token";

import { Button } from "@shared/shadcn/ui/button";
import { Dialog, DialogContent } from "@shared/shadcn/ui/dialog";
import { Progress } from "@shared/shadcn/ui/progress";


export const Stream = () => {
    const { id } = useParams();

    const { data: stream, error } = useStream(id);
    const { data: token } = useToken(stream ? stream.tokenId.toString() : null);
    const { data: currentUser } = useCurrentUser();
    const { data: nft } = useNft(stream?.nftId.toString());

    const { mutateAsync: deposit } = useDeposit();
    const { mutateAsync: claim, isPending: isClaiming } = useClaim();
    const [showModal, setShowModal] = useState(false);

    const form = useAppForm({
        defaultValues: {
            amount: "",
            memo: "",
            nftId: id,
            tokenId: stream?.tokenId,
        },
        onSubmit: async ({ value }) => {
            await deposit({
                tokenId: String(value.tokenId),
                amount: value.amount,
                memo: value.memo,
                nftId: value.nftId!,
            });
            setShowModal(false);
        },
    });

    const isHoldingNft = currentUser === nft?.owner?.account;

    console.log({ isHoldingNft, currentUser, nft });

    const isEmpty = stream && stream.deposited === stream.claimed;

    const percent = stream
        ? isEmpty
            ? 100
            : (Number(stream.claimable) / Number(stream.unclaimed)) * 100
        : 50;

    console.log({ isEmpty, percent, stream }, Number(stream?.claimable), Number(stream?.unclaimed));

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="rounded-sm border p-3">
            <Progress className="my-2" value={percent} />
            <div className="flex justify-between">
                <div className="">
                    <span className="text-muted-foreground">Stream</span> #{id}
                </div>
                <div>
                    <div className="flex gap-2">
                        <Dialog
                            open={showModal}
                            onOpenChange={(show) => {
                                setShowModal(show);
                            }}
                        >
                            <Button
                                onClick={() => {
                                    setShowModal(true);
                                }}
                                variant="outline"
                            >
                                Deposit
                            </Button>
                            <DialogContent>
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        form.handleSubmit();
                                    }}
                                    className="space-y-4"
                                >
                                    <form.AppField
                                        name="amount"
                                        children={(field) => (
                                            <field.TextField label="Amount" />
                                        )}
                                    />

                                    <form.AppField
                                        name="memo"
                                        children={(field) => (
                                            <field.TextField label="Memo" />
                                        )}
                                    />

                                    <div className="flex justify-between">
                                        <form.AppForm>
                                            <form.SubmitButton
                                                labels={[
                                                    "Save",
                                                    "Saving",
                                                    "Saved",
                                                ]}
                                            />
                                        </form.AppForm>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                        <Button
                            disabled={
                                !isHoldingNft ||
                                isClaiming ||
                                isEmpty ||
                                (stream && Number(stream.claimable) == 0)
                            }
                            onClick={() => claim({ nftId: id! })}
                        >
                            Claim{" "}
                            <NumberFlow
                                value={stream ? Number(stream.claimable) : 0}
                                format={{
                                    minimumFractionDigits: token
                                        ? token.precision
                                        : 4,
                                }}
                            />
                        </Button>
                    </div>
                </div>
            </div>
            <div className="text-muted-foreground">
                <div>
                    Unclaimed:{" "}
                    <span className="text-primary">
                        <NumberFlow
                            value={stream ? Number(stream.unclaimed) : 0}
                            format={{ minimumFractionDigits: 0 }}
                        />
                    </span>
                </div>
            </div>
        </div>
    );
};
