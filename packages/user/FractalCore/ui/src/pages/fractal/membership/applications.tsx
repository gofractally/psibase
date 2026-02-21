import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/empty-block";
import { ApplyGuildModal } from "@/components/modals/apply-guild-modal";

import { useGuildApplications } from "@/hooks/fractals/use-guild-applications";
import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import {Button } from "@shared/shadcn/ui/button"
import { InviteGuildMemberModal } from "@/components/modals/invite-guild-member-modal";
import { useBoolean } from "usehooks-ts";
import { useGuildApplication } from "@/hooks/fractals/use-guild-application";

export const Applications = () => {
    const { data: guild } = useGuild();
    const { data: applications } = useGuildApplications(guild?.account);


    const { setValue: setGuildInviteModal, value: showGuildInviteModal } = useBoolean()
    const {setValue: setShowGuildApplyModal, value: showGuildApplyModal, } = useBoolean();
    
    const navigate = useNavigate();

    const guildAccount = useGuildAccount();
    const { data: currentUser } = useCurrentUser();
    const { data: memberships, isPending } =
        useGuildMembershipsOfUser(currentUser);
    const isGuildMember = memberships?.some(
        (membership) => membership.guild.account == guildAccount,
    );

    const { data: pendingApplicant,} = useGuildApplication(guildAccount, currentUser);



    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Applications</h1>
            </div>
            <ApplyGuildModal
                openChange={(e) => setShowGuildApplyModal(e)}
                show={showGuildApplyModal}
            />
            <InviteGuildMemberModal 
                openChange={(e) => setGuildInviteModal(e)}
                show={showGuildInviteModal}            />
            <div className="mt-3">
                <div className="flex justify-end">
                    {isGuildMember && <Button variant={"secondary"} onClick={() => { setGuildInviteModal(true)}} >Create invite</Button>}
                    {!isGuildMember && !pendingApplicant && <Button variant={"secondary"} onClick={() => { setShowGuildApplyModal(true)}} >Apply</Button>}
                    {!isGuildMember && pendingApplicant && <Button onClick={() => { navigate(currentUser!)}} >Pending application</Button>}

                </div>
                {applications && applications.length > 0 ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead>Attestations</TableHead>
                                <TableHead>Application created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {applications.map((member) => (
                                <TableRow
                                    key={member.applicant}
                                    onClick={() => {
                                        navigate(member.applicant);
                                    }}
                                >
                                    <TableCell className="font-medium">
                                        {member.applicant}
                                    </TableCell>
                                    <TableCell>
                                        {member.attestations.nodes.length}
                                    </TableCell>
                                    <TableCell>
                                        {member.createdAt.format(
                                            "ddd MMM D, HH:mm",
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <EmptyBlock
                        title="No applications"
                        description="There are no applicants awaiting to join this guild."
                        buttonLabel="Apply"
                        onButtonClick={
                            isGuildMember || isPending
                                ? undefined
                                : () => {
                                      setShowGuildApplyModal(true);
                                  }
                        }
                    />
                )}
            </div>
        </div>
    );
};
