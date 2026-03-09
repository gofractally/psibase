import dayjs from "dayjs";
import { UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { PageContainer } from "@/components/page-container";

import { useGuildApplication } from "@/hooks/fractals/use-guild-application";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { EmptyBlock } from "@shared/components/empty-block";
import { GlowingCard } from "@shared/components/glowing-card";
import { TableContact } from "@shared/components/tables/table-contact";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { AlertConfirmAcceptApplication } from "./components/alert-confirm-accept-application";
import { AlertConfirmRejectApplication } from "./components/alert-confirm-reject-application";
import { ModalAttest } from "./components/modal-attest";

export const ApplicationDetail = () => {
    const [endorsing, setEndorsing] = useState(false);
    const [objecting, setObjecting] = useState(false);

    const { applicant } = useParams();

    const { data: currentUser } = useCurrentUser();
    const guildAccount = useGuildAccount();
    const guild = useGuild();
    const { data: application } = useGuildApplication(guildAccount, applicant);

    const isSelf = currentUser == applicant;

    if (application === null) {
        return (
            <PageContainer className="space-y-4">
                <GlowingCard>
                    <CardContent>
                        <EmptyBlock
                            title="Application not found"
                            description={`Application for ${applicant} to join ${guild.data?.displayName || "this guild"} does not exist.`}
                        />
                    </CardContent>
                </GlowingCard>
            </PageContainer>
        );
    }

    return (
        <PageContainer className="space-y-4">
            <ModalAttest
                endorses={true}
                openChange={(show) => setEndorsing(show)}
                show={endorsing}
            />
            <ModalAttest
                endorses={false}
                openChange={(show) => setObjecting(show)}
                show={objecting}
            />
            <GlowingCard>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                        {applicant ? (
                            <TableContact account={applicant} />
                        ) : (
                            "Loading..."
                        )}
                        {isSelf && <Badge variant="secondary">You</Badge>}
                    </CardTitle>
                    <CardDescription>
                        Application to join{" "}
                        {guild.data?.displayName || "this guild"}
                    </CardDescription>
                    <CardAction className="flex gap-2">
                        <AlertConfirmRejectApplication applicant={applicant}>
                            <Button variant="destructive" size="sm">
                                Reject (temp)
                            </Button>
                        </AlertConfirmRejectApplication>
                        <AlertConfirmAcceptApplication applicant={applicant}>
                            <Button variant="outline" size="sm">
                                Accept (temp)
                            </Button>
                        </AlertConfirmAcceptApplication>
                    </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-2 text-sm">
                        <div>
                            <span className="text-muted-foreground">
                                Submitted:
                            </span>{" "}
                            {application
                                ? dayjs(application.createdAt).format("llll")
                                : "Loading..."}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">Application notes</p>
                        <p className="text-muted-foreground whitespace-pre-wrap text-sm">
                            {application?.extraInfo ||
                                "No additional details were provided."}
                        </p>
                    </div>
                </CardContent>
            </GlowingCard>
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Attestations</CardTitle>
                    <CardDescription>
                        Endorsements and objections submitted by guild members.
                    </CardDescription>
                    <CardAction className="flex gap-2">
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setObjecting(true)}
                        >
                            <UserX data-icon="inline-start" /> Object
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEndorsing(true)}
                        >
                            <UserCheck data-icon="inline-start" /> Endorse
                        </Button>
                    </CardAction>
                </CardHeader>
                <CardContent>
                    {application?.attestations?.nodes.length ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Attester</TableHead>
                                    <TableHead>Position</TableHead>
                                    <TableHead>Comment</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {application.attestations.nodes.map(
                                    (attest) => (
                                        <TableRow key={attest.attester}>
                                            <TableCell className="font-medium">
                                                <TableContact
                                                    account={attest.attester}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={
                                                        attest.endorses
                                                            ? "default"
                                                            : "destructive"
                                                    }
                                                >
                                                    {attest.endorses
                                                        ? "For"
                                                        : "Against"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {attest.comment ||
                                                    "No comment provided."}
                                            </TableCell>
                                        </TableRow>
                                    ),
                                )}
                            </TableBody>
                        </Table>
                    ) : (
                        <EmptyBlock
                            title="No attestations"
                            description="No attestations have been made in favour or against this application."
                        />
                    )}
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
