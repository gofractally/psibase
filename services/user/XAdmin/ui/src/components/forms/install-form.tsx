import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BootState, PackageInfo, ProducerType } from "@/types";
import { UseFormReturn } from "react-hook-form";
import { PsinodeConfig } from "@/configuration/interfaces";
import { Button } from "../ui/button";

import { bootChain } from "@/lib/bootChain";

interface InstallFormProps {
    packages: PackageInfo[];
    producerForm: UseFormReturn<ProducerType>;
    config?: PsinodeConfig;
    setCurrentPage: (page: string) => void;
    setBootState: (state: BootState) => void;
}

export const InstallForm = ({
    packages,
    config,
    producerForm,
    setCurrentPage,
    setBootState,
}: InstallFormProps) => {
    let nameChange = undefined;
    let actualProducer = producerForm.getValues("producer");
    if (config && config.producer !== actualProducer) {
        nameChange = actualProducer;
    }

    console.log({ packages });
    return (
        <>
            {nameChange && (
                <h4 className="my-3 scroll-m-20 text-xl font-semibold tracking-tight">
                    <span className="text-muted-foreground">
                        The block producer name of this node will be set to{" "}
                    </span>
                    {nameChange}
                </h4>
            )}
            <ScrollArea className=" h-[800px]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableCell
                                colSpan={4}
                                className="mx-auto bg-primary-foreground text-center"
                            >
                                The following packages will be installed
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>File</TableHead>
                            <TableHead className="text-right">
                                Version
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {packages.map((info) => (
                            <TableRow key={info.sha256}>
                                <div>{JSON.stringify(info)}</div>
                                <TableCell>{info.name}</TableCell>
                                <TableCell>{info.description}</TableCell>
                                <TableCell>{info.file}</TableCell>
                                <TableCell className="text-right">
                                    {info.version}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
            <form
                className="flex w-full justify-between"
                onSubmit={() => {
                    bootChain(packages, actualProducer, setBootState);
                    setCurrentPage("go");
                }}
            >
                <Button
                    variant="secondary"
                    className="mt-4"
                    onClick={() => setCurrentPage("producer")}
                >
                    Back
                </Button>
                <Button className="mt-4" type="submit">
                    Install
                </Button>
            </form>
        </>
    );
};
