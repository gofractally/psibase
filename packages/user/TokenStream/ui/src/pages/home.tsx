import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@shared/components/empty-block";
import { useAppForm } from "@shared/components/form/app-form";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { useCreateStream } from "../hooks/use-create-stream";
import { useStreams } from "../hooks/use-streams";

export const Home = () => {
    const navigate = useNavigate();

    const { data: streams, isLoading: isLoadingStream } = useStreams();
    const { data: currentUser, isLoading: isLoadingCurrentUser } =
        useCurrentUser();
    const { mutateAsync: createStream } = useCreateStream();
    const { mutateAsync: login } = useConnectAccount();

    const isLoading = isLoadingStream || isLoadingCurrentUser;

    const [showModal, setShowModal] = useState(false);

    const form = useAppForm({
        defaultValues: {
            halfLifeSeconds: "",
            tokenId: "",
        },
        onSubmit: async ({ value }) => {
            await createStream({
                halfLifeSeconds: Number(value.halfLifeSeconds),
                tokenId: Number(value.tokenId),
            });
            setShowModal(false);
        },
    });

    return (
        <div>
            <Dialog
                open={showModal}
                onOpenChange={(show) => {
                    setShowModal(show);
                }}
            >
                <div className="my-2 flex items-center justify-between rounded-sm border p-6">
                    <div>
                        <div className="font-semibold">Token stream</div>
                        <div className="text-muted-foreground text-sm">
                            Create and manage token streams
                        </div>
                    </div>
                    {currentUser ? (
                        <Button onClick={() => setShowModal(true)}>
                            Create
                        </Button>
                    ) : (
                        <Button onClick={() => login()}>
                            Log in to continue
                        </Button>
                    )}
                </div>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create stream</DialogTitle>
                        <DialogDescription>
                            Create a new token stream.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            form.handleSubmit();
                        }}
                        className="space-y-4"
                    >
                        <form.AppField
                            name="tokenId"
                            children={(field) => (
                                <field.NumberField label="Token ID" />
                            )}
                        />
                        <form.AppField
                            name="halfLifeSeconds"
                            children={(field) => (
                                <field.DurationSelectField
                                    label="Half life"
                                    defaultFrequency="Hours"
                                />
                            )}
                        />
                        <div className="flex justify-between">
                            <form.AppForm>
                                <form.SubmitButton />
                            </form.AppForm>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
            <div>
                {streams?.length == 0 ? (
                    <EmptyBlock
                        title="No streams"
                        buttonLabel="Create stream"
                        disabled={!currentUser}
                        onButtonClick={() => setShowModal(true)}
                    />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[100px]">
                                    NFT ID
                                </TableHead>
                                <TableHead className="text-right">
                                    Claimable
                                </TableHead>
                                <TableHead className="text-right">
                                    Unclaimed
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading
                                ? [...new Array(4)].map((_, index) => (
                                      <TableRow key={index}>
                                          <TableCell className="font-medium">
                                              <Skeleton className="h-6 w-48" />
                                          </TableCell>
                                          <TableCell className="text-right">
                                              <Skeleton className="h-6 w-48" />
                                          </TableCell>
                                          <TableCell className="text-right">
                                              <Skeleton className="h-6 w-48" />
                                          </TableCell>
                                          <TableCell className="text-right">
                                              <Skeleton className="h-6 w-48" />
                                          </TableCell>
                                      </TableRow>
                                  ))
                                : streams?.map((stream) => (
                                      <TableRow key={stream.nftId.toString()}>
                                          <TableCell className="font-medium">
                                              {stream.nftId}
                                          </TableCell>
                                          <TableCell className="text-right">
                                              {stream.claimable}
                                          </TableCell>
                                          <TableCell className="text-right">
                                              {stream.unclaimed}
                                          </TableCell>
                                          <TableCell className="flex justify-end">
                                              <Button
                                                  variant="outline"
                                                  onClick={() => {
                                                      navigate(
                                                          `/stream/${stream.nftId}`,
                                                      );
                                                  }}
                                              >
                                                  Open
                                              </Button>
                                          </TableCell>
                                      </TableRow>
                                  ))}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    );
};
