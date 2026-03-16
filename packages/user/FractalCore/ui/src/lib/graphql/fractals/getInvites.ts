import { supervisor } from "@shared/lib/supervisor";

import { getGuildInvite } from "./getGuildInvite";
import { getInviteById } from "./getInviteById";
import z from "zod";


export const importToken = async (token: string): Promise<number> => {
    return z.number().int().parse(await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "importInviteToken",
        params: [token],
    }));

}

export const getInvites = async (inviteId: number) => {

    const [guildInvite, vanillaInvite] = await Promise.all([
        getGuildInvite(inviteId),
        getInviteById(inviteId),
    ]);

    if (!guildInvite || !vanillaInvite) {
        const inviter = guildInvite?.inviter ?? "the person who invited you";

        const serviceName = !vanillaInvite
            ? "invite service"
            : "fractals service";

        throw new Error(
            `Invite ${inviteId} no longer exists on the ${serviceName}. Please contact ${inviter} for a new invite.`,
        );
    }

    return { guildInvite, vanillaInvite };
};
