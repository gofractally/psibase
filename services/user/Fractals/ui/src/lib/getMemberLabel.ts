import { MemberStatus } from "./zod/MemberStatus";

export const getMemberLabel = (status: MemberStatus): string =>
    status == MemberStatus.Citizen
        ? "Citizen"
        : status == MemberStatus.Visa
          ? "Visa"
          : "Exiled";