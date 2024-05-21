import * as React from "react";
import {
    AlertCircle,
    Archive,
    User,
    CheckSquare,
    List,
    MessagesSquare,
    Search,
    Gavel,
    ShoppingCart,
    Users2,
} from "lucide-react";

import { cn } from "@lib/utils";
import { Input } from "@shadcn/input";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { Separator } from "@shadcn/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/tabs";
import { TooltipProvider } from "@shadcn/tooltip";

import { AccountSwitcher } from "./account-switcher";
import { MailDisplay } from "./mail-display";
import { MailList } from "./mail-list";
import { Nav } from "./nav";
import { type Mail } from "../fixtures/data";
import { useMail } from "../fixtures/use-mail";

interface MailProps {
    accounts: {
        label: string;
        email: string;
    }[];
    mails: Mail[];
    navCollapsedSize: number;
}

export function Mail({ accounts, mails, navCollapsedSize }: MailProps) {
    const [mail] = useMail();
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    return (
        <TooltipProvider delayDuration={0}>
            <ResizablePanelGroup
                direction="horizontal"
                className="max-h-screen items-stretch"
                autoSaveId="react-resizable-panels"
            >
                <ResizablePanel
                    collapsedSize={navCollapsedSize}
                    collapsible={true}
                    minSize={15}
                    maxSize={20}
                    onCollapse={() => setIsCollapsed(true)}
                    onExpand={() => setIsCollapsed(false)}
                    className={cn(
                        isCollapsed &&
                            "min-w-[50px] transition-all duration-300 ease-in-out",
                    )}
                >
                    <div
                        className={cn(
                            "flex h-14 items-center justify-center",
                            isCollapsed ? "h-14" : "px-2",
                        )}
                    >
                        <AccountSwitcher
                            isCollapsed={isCollapsed}
                            accounts={accounts}
                        />
                    </div>
                    <Separator />
                    <Nav
                        isCollapsed={isCollapsed}
                        links={[
                            {
                                title: "Feed",
                                label: "128",
                                icon: List,
                                variant: "default",
                            },
                            {
                                title: "Participate",
                                label: "9",
                                icon: CheckSquare,
                                variant: "ghost",
                            },
                            {
                                title: "Govern",
                                label: "",
                                icon: Gavel,
                                variant: "ghost",
                            },
                            {
                                title: "Membership",
                                label: "23",
                                icon: User,
                                variant: "ghost",
                            },
                        ]}
                    />
                    <Separator />
                    <Nav
                        isCollapsed={isCollapsed}
                        links={[
                            {
                                title: "All",
                                label: "972",
                                icon: Users2,
                                variant: "ghost",
                            },
                            {
                                title: "Contributions",
                                label: "342",
                                icon: AlertCircle,
                                variant: "ghost",
                            },
                            {
                                title: "Petitions",
                                label: "128",
                                icon: MessagesSquare,
                                variant: "ghost",
                            },
                            {
                                title: "Council",
                                label: "8",
                                icon: ShoppingCart,
                                variant: "ghost",
                            },
                            {
                                title: "Foreign Relations",
                                label: "21",
                                icon: Archive,
                                variant: "ghost",
                            },
                        ]}
                    />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel minSize={30}>
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
                                    <Input
                                        placeholder="Search"
                                        className="pl-8"
                                    />
                                </div>
                            </form>
                        </div>
                        <TabsContent value="all" className="m-0">
                            <MailList items={mails} />
                        </TabsContent>
                        <TabsContent value="members" className="m-0">
                            <MailList
                                items={mails.filter((item) => !item.read)}
                            />
                        </TabsContent>
                    </Tabs>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel>
                    <MailDisplay
                        mail={
                            mails.find((item) => item.id === mail.selected) ||
                            null
                        }
                    />
                </ResizablePanel>
            </ResizablePanelGroup>
        </TooltipProvider>
    );
}
