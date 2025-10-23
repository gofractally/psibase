import { z } from "zod";

export enum MemberStatus {
    Visa = 1,
    Citizen = 2,
    Exiled = 3,
}

export const zMemberStatus = z.nativeEnum(MemberStatus);
