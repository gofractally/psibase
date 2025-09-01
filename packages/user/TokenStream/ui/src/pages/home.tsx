import { useState } from "react";
import { useNavigate } from "react-router-dom";


import { Button } from "@shared/shadcn/ui/button";
import { Dialog, DialogContent } from "@shared/shadcn/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { useAppForm } from "../form/app-form";
import { useCreateStream } from "../hooks/use-create-stream";
import { useStreams } from "../hooks/use-streams";

export const Home = () => {
    const { data } = useStreams();
    const { mutateAsync: createStream } = useCreateStream();

    console.log(data, "is the data");

    const [showModal, setShowModal] = useState(false);

    const form = useAppForm({
        defaultValues: {
            halfLifeSeconds: "",
            tokenId: "1",
        },
        onSubmit: async ({ value }) => {
            await createStream({
                halfLifeSeconds: Number(value.halfLifeSeconds),
                tokenId: Number(value.tokenId),
            });
            setShowModal(false);
        },
    });

    const navigate = useNavigate();

    return (
        <div >
            <TableBody />
            <Dialog
                open={showModal}
                onOpenChange={(show) => {
                    setShowModal(show);
                }}
            >
                <div className="my-2 flex justify-between rounded-sm border p-6">
                    <div>
                        <div className="font-semibold">Token stream</div>
                        <div className="text-muted-foreground text-sm">
                            Create and manage token streams
                        </div>
                    </div>
                    <div>
                        <Button
                            onClick={() => {
                                setShowModal(true);
                            }}
                        >
                            Create
                        </Button>
                    </div>
                </div>
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
                            name="halfLifeSeconds"
                            children={(field) => (
                                <field.Duration
                                    label="Half life"
                                    defaultFrequency="Hours"
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
            <div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">NFT ID</TableHead>
                            <TableHead className="text-right">Claimable</TableHead>
                            <TableHead className="text-right">Total remaining</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data?.map((stream) => (
                            <TableRow id={stream.nftId.toString()}>
                                <TableCell className="font-medium">
                                    {stream.nftId}
                                </TableCell>
                                <TableCell className="text-right">{stream.vested}</TableCell>
                                <TableCell className="text-right">
                                    {stream.unclaimed}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            navigate(`/stream/${stream.nftId}`);
                                        }}
                                    >
                                        Open
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>{" "}
            </div>
        </div>
    );
};
