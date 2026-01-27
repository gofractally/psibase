import { z } from "zod";

export const zTrustLevel = z.enum(["low", "medium", "high"]); // 'none' and 'max' do not trigger a permissions prompt
export type TrustLevel = z.infer<typeof zTrustLevel>;

export const zDescriptions = z.tuple([z.string(), z.string(), z.string()]);
export type Descriptions = z.infer<typeof zDescriptions>;

export const zApprovalDuration = z.enum(["session", "permanent"]);
export type ApprovalDuration = z.infer<typeof zApprovalDuration>;

export const zPermissionRequest = z.object({
    user: z.string(),
    caller: z.string(),
    callee: z.string(),
    level: zTrustLevel,
    descriptions: zDescriptions,
});

export type PermissionRequest = z.infer<typeof zPermissionRequest>;
