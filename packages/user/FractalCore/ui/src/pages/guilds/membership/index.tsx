import { PageContainer } from "@/components/page-container";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

import { Applicants } from "./applicants";
import { Members } from "./members";

export const Membership = () => {
    return (
        <PageContainer className="space-y-4">
            <Tabs defaultValue="members">
                <TabsList>
                    <TabsTrigger value="members">Members</TabsTrigger>
                    <TabsTrigger value="applicants">Applicants</TabsTrigger>
                </TabsList>
                <TabsContent value="members">
                    <Members />
                </TabsContent>
                <TabsContent value="applicants">
                    <Applicants />
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
};
