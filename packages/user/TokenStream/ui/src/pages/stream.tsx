import { useAppForm } from "@/form/app-form";
import NumberFlow from "@number-flow/react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { ErrorCard } from "@/components/error-card";

import { useCurrentUser } from "@/hooks";
import { useClaim } from "@/hooks/use-claim";
import { useDeleteStream } from "@/hooks/use-delete-stream";
import { useDeposit } from "@/hooks/use-deposit";
import { useNft } from "@/hooks/use-nft";
import { useStream } from "@/hooks/use-stream";
import { useToken } from "@/hooks/use-token";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Progress } from "@shared/shadcn/ui/progress";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const Stream = () => {
    const { id } = useParams();

    const { data: stream, error, isLoading: isLoadingStream } = useStream(id);
    const { data: token } = useToken(
        stream ? stream.stream.tokenId.toString() : null,
    );
    const { data: currentUser } = useCurrentUser();
    const { data: nft } = useNft(stream?.stream.nftId.toString());

    const { mutateAsync: deposit } = useDeposit();
    const { mutateAsync: claim, isPending: isClaiming } = useClaim();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    const { mutateAsync: deleteStream, isPending: isDeleting } =
        useDeleteStream();

    const form = useAppForm({
        defaultValues: {
            amount: "",
            memo: "",
            nftId: id,
            tokenId: stream?.stream.tokenId,
        },
        onSubmit: async ({ value }) => {
            await deposit({
                tokenId: String(value.tokenId),
                amount: value.amount,
                memo: value.memo,
                nftId: value.nftId!,
            });
            setShowCreateModal(false);
            form.reset();
        },
    });

    const isHoldingNft = currentUser === nft?.owner?.account;

    const isEmpty =
        stream && stream?.stream.deposited === stream?.stream.claimed;
    const isFullyClaimed =
        stream && stream.stream.claimed === stream.stream.deposited;

    const percent = stream
        ? isEmpty
            ? 100
            : (Number(stream.stream.claimable) /
                  Number(stream.stream.unclaimed)) *
              100
        : 50;

    console.log(
        { isEmpty, percent, stream },
        Number(stream?.stream.claimable),
        Number(stream?.stream.unclaimed),
    );

    if (error) {
        console.error(error);
        return <ErrorCard error={error} />;
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="rounded-sm border p-3">
                <div className="my-3 w-full">
                    <Progress value={percent} />
                </div>
                <div className="flex justify-between">
                    <div className="">
                        <span className="text-muted-foreground">Stream</span> #
                        {id}
                    </div>
                    <div>
                        <div className="flex gap-2">
                            <Dialog
                                open={showCreateModal}
                                onOpenChange={(show) => {
                                    setShowCreateModal(show);
                                }}
                            >
                                <Button
                                    onClick={() => {
                                        setShowCreateModal(true);
                                    }}
                                    variant="outline"
                                >
                                    <ArrowUp />
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
                                    (stream &&
                                        Number(stream.stream.claimable) == 0)
                                }
                                onClick={() => claim({ nftId: id! })}
                            >
                                <ArrowDown />
                                {isClaiming ? "Claiming" : "Claim"}
                                <NumberFlow
                                    value={
                                        stream
                                            ? Number(stream.stream.claimable)
                                            : 0
                                    }
                                    format={{
                                        minimumFractionDigits: token
                                            ? token.precision
                                            : 4,
                                    }}
                                />
                            </Button>
                            <Dialog
                                open={showDeleteModal}
                                onOpenChange={(show) => {
                                    setShowCreateModal(show);
                                }}
                            >
                                <Button
                                    variant="outline"
                                    disabled={!isFullyClaimed || isDeleting}
                                    onClick={() => {
                                        setShowDeleteModal(true);
                                    }}
                                >
                                    <Trash2 />
                                </Button>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Delete stream</DialogTitle>
                                        <DialogDescription>
                                            Are you sure you want to delete
                                            stream ID: {id}
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <Button
                                            type="submit"
                                            onClick={() =>
                                                deleteStream({ nftId: id! })
                                            }
                                        >
                                            Delete
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </div>
                <div className="text-muted-foreground my-2 flex justify-between">
                    <div>
                        Balance:{" "}
                        <span className="text-primary">
                            <NumberFlow
                                value={
                                    stream ? Number(stream.stream.unclaimed) : 0
                                }
                                format={{
                                    minimumFractionDigits: token
                                        ? token.precision
                                        : 4,
                                }}
                            />
                        </span>
                    </div>
                    <div>
                        <Badge variant="outline">
                            Token ID: {stream?.stream.tokenId}
                        </Badge>
                    </div>
                </div>
            </div>
            <div className="rounded-sm border p-3">
                <Table className="text-sm">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Actor</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="text-muted-foreground">
                        {isLoadingStream
                            ? [...new Array(4)].map((_, index) => (
                                  <TableRow key={index}>
                                      <TableCell>
                                          <Skeleton className="h-6 w-48" />
                                      </TableCell>
                                      <TableCell>
                                          <Skeleton className="h-6 w-48" />
                                      </TableCell>
                                      <TableCell className="flex justify-end text-right">
                                          <Skeleton className="h-6 w-48" />
                                      </TableCell>
                                  </TableRow>
                              ))
                            : stream?.updates?.map((update, index) => (
                                  <TableRow key={index}>
                                      <TableCell>
                                          {update.txType == "claimed" ? (
                                              <div className="flex items-center gap-2">
                                                  <ArrowDown />
                                                  Claimed
                                              </div>
                                          ) : (
                                              <div className="flex items-center gap-2">
                                                  <ArrowUp />
                                                  Deposited
                                              </div>
                                          )}
                                      </TableCell>
                                      <TableCell>{update.actor}</TableCell>
                                      <TableCell className="text-right">
                                          {update.amount}
                                      </TableCell>{" "}
                                  </TableRow>
                              ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};
