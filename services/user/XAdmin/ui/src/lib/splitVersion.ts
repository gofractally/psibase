import { z } from "zod";

const VersionSchema = z.tuple([z.number(), z.number(), z.number()]);
export type ParsedVersion = [major: number, minor: number, patch: number];

export const splitVersion = (version: string): ParsedVersion | undefined => {
    const parsed = VersionSchema.safeParse(version.split(".").map(Number));
    if (parsed.success) {
        return parsed.data;
    } else return;
};

export const isLeftLessThanRight = (
    left: ParsedVersion | undefined,
    right: ParsedVersion | undefined
): boolean => {
    if (left && right) {
        for (let i = 0; i < 3; ++i) {
            if (left[i] != right[i]) {
                return left[i] < right[i];
            }
        }
        return false;
    }
    return !!right;
};
