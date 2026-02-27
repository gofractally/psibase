import { useState } from "react";
import { useParams } from "react-router-dom";

import { AttestGuildMemberModal } from "@/components/modals/attest-guild-member-modal";
import { PageContainer } from "@/components/page-container";

import { useGuildApplication } from "@/hooks/fractals/use-guild-application";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { EmptyBlock } from "@shared/components/empty-block";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const ApplicationDetail = () => {
    const [showModal, setShowModal] = useState(false);

    const { applicant } = useParams();

    const { data: currentUser } = useCurrentUser();
    const guildAccount = useGuildAccount();
    const guild = useGuild();
    const { data: application, isPending } = useGuildApplication(
        guildAccount,
        applicant,
    );

    const isSelf = currentUser == applicant;

    if (application === null) {
        return (
            <PageContainer>
                Application for {currentUser} to join the guild{" "}
                {guild.data?.displayName} does not exist.
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <AttestGuildMemberModal
                openChange={(e) => setShowModal(e)}
                show={showModal}
            />
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">
                    Application {applicant}
                </h1>
            </div>
            <div className="flex flex-col gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <div>
                                <div className="text-xl font-semibold">
                                    {applicant || "Loading..."}
                                </div>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {application?.extraInfo}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <div>
                                <div className="text-xl font-semibold">
                                    Attestations
                                </div>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col gap-2">
                            {application?.attestations &&
                            application?.attestations.nodes.length > 0 ? (
                                application?.attestations.nodes.map(
                                    (attest) => (
                                        <div
                                            key={attest.attester}
                                            className="flex justify-between px-2"
                                        >
                                            <div>
                                                <div>{attest.attester}</div>
                                                <div>{attest.comment}</div>
                                            </div>
                                            <div>
                                                {attest.endorses
                                                    ? "For"
                                                    : "Against"}
                                            </div>
                                        </div>
                                    ),
                                )
                            ) : (
                                <EmptyBlock
                                    title="No attestations"
                                    onButtonClick={
                                        isSelf
                                            ? undefined
                                            : () => {
                                                  setShowModal(true);
                                              }
                                    }
                                    buttonLabel="Create attestation"
                                    description="No attestations have been made in favour or against this application."
                                    isLoading={isPending}
                                />
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </PageContainer>
    );
};
