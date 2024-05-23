import type { Mail } from "../fixtures/data";

import { useLoaderData } from "react-router-dom";
import { Search } from "lucide-react";

import { Input } from "@shadcn/input";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { Separator } from "@shadcn/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/tabs";

import { MailDisplay } from "@components/mail-display";
import { MailList } from "@components/mail-list";

import { mails } from "../fixtures/data";
import { useMail } from "../fixtures/use-mail";

export const homeLoader = () => {
    return { mails };
};

export function Home() {
    // while this isn't strictly necessary right now (we could use accounts and mails directly,
    // this is a good example of how to use useLoaderData() and could come in handy in the future.
    const { mails: mailData } = useLoaderData() as {
        mails: Mail[];
    };

    const [mail] = useMail();

    return (
        <ResizablePanelGroup
            direction="horizontal"
            className="items-stretch"
            autoSaveId="post-list-panels"
        >
            <ResizablePanel minSize={30} id="list" order={3}>
                <Tabs defaultValue="all">
                    <div className="flex items-center px-4 py-2">
                        <h1 className="text-xl font-bold">Feed</h1>
                        <TabsList className="ml-auto">
                            <TabsTrigger
                                value="all"
                                className="text-zinc-600 dark:text-zinc-200"
                            >
                                All
                            </TabsTrigger>
                            <TabsTrigger
                                value="members"
                                className="text-zinc-600 dark:text-zinc-200"
                            >
                                Members
                            </TabsTrigger>
                            <TabsTrigger
                                value="non-members"
                                className="text-zinc-600 dark:text-zinc-200"
                            >
                                Non-members
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    <Separator />
                    <div className="bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                        <form>
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search" className="pl-8" />
                            </div>
                        </form>
                    </div>
                    <TabsContent value="all" className="m-0">
                        <MailList items={mailData} />
                    </TabsContent>
                    <TabsContent value="members" className="m-0">
                        <MailList
                            items={mailData.filter((item) => !item.read)}
                        />
                    </TabsContent>
                </Tabs>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="post" order={4}>
                <MailDisplay
                    mail={
                        mailData.find((item) => item.id === mail.selected) ||
                        null
                    }
                />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

export default Home;
