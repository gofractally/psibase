import { Link, Outlet, useLocation } from "react-router-dom";

import { PageContainer } from "@/components/page-container";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

export const GuildMembershipLayout = () => {
    const location = useLocation();
    const tab = location.pathname.split("/").pop();

    return (
        <PageContainer className="space-y-4">
            <Tabs value={tab}>
                <TabsList>
                    <TabsTrigger value="members" asChild>
                        <Link to="members">Members</Link>
                    </TabsTrigger>
                    <TabsTrigger value="applicants" asChild>
                        <Link to="applicants">Applicants</Link>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="members">
                    <Outlet />
                </TabsContent>
                <TabsContent value="applicants">
                    <Outlet />
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
};
