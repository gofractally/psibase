import { useParams } from "react-router-dom"

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { useGuildApplication } from "@/hooks/fractals/use-guild-application";
import { useGuild } from "@/hooks/use-guild";
import { EmptyBlock } from "@/components/empty-block";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useState } from "react";
import { AttestGuildMemberModal } from "@/components/modals/attest-guild-member-modal";

export const ApplicationDetail = () => {


    const { applicant } = useParams();
    const { data: guild } = useGuild();

    const { data: currentUser } = useCurrentUser();
    const { data: application, isPending } = useGuildApplication(guild?.id, applicant);


    const isSelf = currentUser == applicant;

    const [showModal, setShowModal] = useState(false);


    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
        <AttestGuildMemberModal openChange={e => setShowModal(e)} show={showModal} />
        <div className="flex h-9 items-center">
            <h1 className="text-lg font-semibold">Application {applicant}</h1>
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
                        {application?.app}
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
                        {(application?.attestations && application?.attestations.length > 0) ? application?.attestations.map(attest => <div key={attest.attestee} className="flex justify-between px-2">
                            <div>
                                <div>
                                    {attest.attestee}
                                </div>
                                <div>
                                    {attest.comment}
                                </div>
                            </div>
                            <div>
                                {attest.endorses ? "For" : "Against"}
                            </div>
                        </div>) : <EmptyBlock title="No attestations" onButtonClick={isSelf ? undefined : () => {
                            setShowModal(true)
                        }} buttonLabel="Create attestation" description="No attestations have been made in favour or against this application." isLoading={isPending} />}
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
}