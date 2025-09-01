import { useStream } from "@/hooks/use-stream";
import { useParams } from "react-router-dom";

import { Progress } from "@shared/shadcn/ui/progress";
import { Button } from "@shared/shadcn/ui/button";

import { ErrorCard } from "@/components/error-card";
import { useState } from "react";
import { Dialog, DialogContent } from "@shared/shadcn/ui/dialog";
import { useAppForm } from "@/form/app-form";
import { useDeposit } from "@/hooks/use-deposit";
import { useNft } from "@/hooks/use-nft";
import { useCurrentUser } from "@/hooks";

import NumberFlow from "@number-flow/react";



// Live update on the progress. 
// Live updates on the vested amount
// Refresh on the total deposited, every 10 seconds
// 

export const Stream = () => {
    const { id } = useParams();

    const { data, error, } = useStream(id ? Number(id) : null)

    const { mutateAsync: deposit } = useDeposit()
    const [showModal, setShowModal] = useState(false);
    const { data: currentUser } = useCurrentUser()

    const { data: nft } = useNft(data?.nftId);

    const form = useAppForm({
        defaultValues: {
            amount: "",
            memo: '',
            nftId: id,
            tokenId: data?.tokenId,
        },
        onSubmit: async ({ value }) => {
            await deposit({
                tokenId: String(value.tokenId),
                amount: value.amount,
                memo: value.memo,
                nftId: value.nftId!
            });
            setShowModal(false);
        },
    });

    // is holding NFT? 
    const isHoldingNft = currentUser === nft?.owner?.account;

    console.log({ isHoldingNft, currentUser, nft })


    if (error) {
        return <ErrorCard error={error} />
    }

    return <div className="rounded-sm border p-3">
        <Progress className="my-2" value={66} />
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
                                        <field.TextField
                                            label="Amount"
                                        />
                                    )}
                                />

                                <form.AppField
                                    name="memo"
                                    children={(field) => (
                                        <field.TextField
                                            label="Memo"
                                        />
                                    )}
                                />

                                <div className="flex justify-between">
                                    <form.AppForm>
                                        <form.SubmitButton
                                            labels={["Save", "Saving", "Saved"]}
                                        />
                                    </form.AppForm>
                                </div>
                            </form>
                        </DialogContent>
                    </Dialog>
                    <Button disabled={!isHoldingNft}>Withdraw</Button>
                </div>
            </div>
        </div>
        <div className="text-muted-foreground">
            <div>Deposited: <span className="text-primary">
                <NumberFlow
                    value={Number(data?.deposited)}
                    format={{ minimumFractionDigits: 4 }}
                />
            </span></div>
            <div>Claimed: <span className="text-primary">{data?.claimed}</span></div>
            <div>Unclaimed: <span className="text-primary">{data?.unclaimed}</span></div>
            <div>Vested: <span className="text-primary">{data?.vested}</span></div>



        </div>
    </div>

};
