import { MemberStatus } from "./schemas/member-status";

export const getMemberLabel = (status: MemberStatus): string =>
    status == MemberStatus.Citizen
        ? "Citizen"
        : status == MemberStatus.Visa
          ? "Visa"
          : "Exiled";
