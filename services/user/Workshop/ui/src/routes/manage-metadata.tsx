import { Separator } from "@shadcn/separator";

import { AppMetadataForm } from "@components/app-metadata-form";
import { ScrollArea } from "@shadcn/scroll-area";
import { ModeToggle } from "@components";

export function ManageAppMetadataPage() {
    return (
        <div className="flex h-full flex-col">
            <div className="container flex h-[56px] flex-shrink-0 items-center justify-between">
                <h1 className="text-xl font-bold">Drafts</h1>
                <ModeToggle />
            </div>
            <Separator className="flex-shrink-0" />
            <ScrollArea className="container h-screen py-4">
                <AppMetadataForm />
            </ScrollArea>
        </div>
    );
}
