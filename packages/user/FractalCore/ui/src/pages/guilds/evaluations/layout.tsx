import { Link, Outlet, useLocation } from "react-router-dom";

import { CurrentEvaluationCard } from "@/components/current-evaluation-card";

import { useGuild } from "@/hooks/use-guild";

import { PageContainer } from "@shared/components/page-container";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

export const GuildEvaluationsLayout = () => {
    const location = useLocation();
    const tab = location.pathname.split("/").pop();
    const { data: guild } = useGuild();
    const showCurrentEvaluation = !!guild?.evalInstance;

    return (
        <PageContainer className="space-y-4">
            {showCurrentEvaluation && <CurrentEvaluationCard />}
            <Tabs value={tab}>
                <TabsList>
                    <TabsTrigger value="upcoming" asChild>
                        <Link to="upcoming">Upcoming</Link>
                    </TabsTrigger>
                    <TabsTrigger value="past" asChild>
                        <Link to="past">Past</Link>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="upcoming">
                    <Outlet />
                </TabsContent>
                <TabsContent value="past">
                    <Outlet />
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
};
