import { Link, Outlet, useLocation } from "react-router-dom";
import { useBoolean } from "usehooks-ts";

import { InviteGuildMemberModal } from "@/components/modals/invite-guild-member-modal";

import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

export const GuildMembershipLayout = () => {
    const location = useLocation();
    const tab = location.pathname.split("/").pop();

    const { value: showModal, setValue: setShowModal } = useBoolean();

    return (
        <PageContainer className="space-y-4">
            <InviteGuildMemberModal
                show={showModal}
                openChange={setShowModal}
            />
            <Tabs value={tab}>
                <div className="flex justify-between">
                    <TabsList>
                        <TabsTrigger value="members" asChild>
                            <Link to="members">Members</Link>
                        </TabsTrigger>
                        <TabsTrigger value="applicants" asChild>
                            <Link to="applicants">Applicants</Link>
                        </TabsTrigger>
                    </TabsList>
                    <Button
                        onClick={() => {
                            setShowModal(true);
                        }}
                    >
                        Create invite
                    </Button>
                </div>
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
