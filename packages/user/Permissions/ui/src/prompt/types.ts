export type TrustLevel = "low" | "medium" | "high"; // 'none' and 'max' do not trigger a permissions prompt

export type Descriptions = [string, string, string];

export type ApprovalDuration = "session" | "permanent";

export interface PermissionRequest {
    user: string;
    caller: string;
    callee: string;
    level: TrustLevel;
    descriptions: Descriptions;
}
