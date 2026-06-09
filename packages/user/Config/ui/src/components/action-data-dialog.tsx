import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { supervisor } from "@shared/lib/supervisor";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@shared/shadcn/ui/dialog";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface ActionDataDialogProps {
    sender: string;
    service: string;
    method: string;
    rawData: string;
    index: number;
    total: number;
}

function queryErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

async function unpackForDisplay(
    service: string,
    method: string,
    rawDataHex: string,
) {
    const result = await supervisor.functionCall({
        service: "packages",
        plugin: "plugin",
        intf: "queries",
        method: "unpackActionParams",
        params: [service, method, rawDataHex],
    });
    const jsonStr = z.string().parse(result);
    try {
        return JSON.stringify(JSON.parse(jsonStr), null, 2);
    } catch {
        return jsonStr;
    }
}

export const ActionDataDialog = ({
    sender,
    service,
    method,
    rawData,
    index,
    total,
}: ActionDataDialogProps) => {
    const trimmed = rawData.trim();
    const hasPayload = trimmed.length > 0;
    const [open, setOpen] = useState(false);

    const unpackQuery = useQuery({
        queryKey: QueryKey.unpackActionParams(service, method, trimmed),
        queryFn: () => unpackForDisplay(service, method, trimmed),
        enabled: open && hasPayload,
        staleTime: Infinity,
        retry: false,
    });

    if (!hasPayload) return null;

    const bodyLoading = unpackQuery.isLoading;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="View action data"
                >
                    <Eye />
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[85vh] min-h-0 flex-col gap-4 overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {sender} → {service}::{method}
                    </DialogTitle>
                    <DialogDescription>
                        Action {index + 1} of {total}
                    </DialogDescription>
                </DialogHeader>
                <div className="h-0 max-h-[min(55vh,32rem)] min-h-0 min-w-0 max-w-full w-full flex-1 overflow-auto overscroll-contain rounded-sm border">
                    <div className="w-max min-w-full p-3 font-mono text-sm">
                        {bodyLoading && (
                            <Skeleton className="h-[min(180px,40vh)] w-full rounded-sm" />
                        )}
                        {!bodyLoading && unpackQuery.isError ? (
                            <div className="space-y-2">
                                <p className="text-destructive whitespace-pre-wrap">
                                    {queryErrorMessage(unpackQuery.error)}
                                </p>
                                <pre className="text-muted-foreground whitespace-pre-wrap">
                                    Raw (hex): {trimmed}
                                </pre>
                            </div>
                        ) : null}
                        {!bodyLoading &&
                        !unpackQuery.isError &&
                        unpackQuery.data !== undefined ? (
                            <pre className="whitespace-pre">
                                {unpackQuery.data}
                            </pre>
                        ) : null}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
