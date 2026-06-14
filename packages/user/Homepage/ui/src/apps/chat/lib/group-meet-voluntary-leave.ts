/** Per-local-account gate for group Meet voluntary leave (survivors must not auto-leave). */
const voluntaryLeaveAccounts = new Set<string>();

export function markVoluntaryGroupMeetLeave(self: string): void {
    voluntaryLeaveAccounts.add(self);
}

export function peekVoluntaryGroupMeetLeave(self: string): boolean {
    return voluntaryLeaveAccounts.has(self);
}

export function consumeVoluntaryGroupMeetLeave(self: string): boolean {
    if (!voluntaryLeaveAccounts.delete(self)) return false;
    return true;
}

export function clearVoluntaryGroupMeetLeave(self: string): void {
    voluntaryLeaveAccounts.delete(self);
}
