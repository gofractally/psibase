import { RowSelectionState } from "@tanstack/react-table";
import { z } from "zod";

const remainingElement = (left: string[], right: string[]): string => {
    const bigArray = left.length > right.length ? left : right;
    const smallArray = left.length > right.length ? right : left;
    const remaining = bigArray.filter(
        (element) => !smallArray.includes(element)
    );
    if (remaining.length !== 1) throw new Error("Expected one difference");
    return z.string().parse(remaining[0]);
};

const ChangeSchema = z
    .object({
        isAddition: z.boolean(),
        name: z.string(),
    })
    .optional();

export const detectChange = (
    before: RowSelectionState,
    after: RowSelectionState
): z.infer<typeof ChangeSchema> => {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);

    const isAddition = afterKeys.length > beforeKeys.length;
    const isNoChange = beforeKeys.length - afterKeys.length == 0;
    if (isNoChange) return;

    return ChangeSchema.parse({
        isAddition,
        name: z.string().parse(remainingElement(beforeKeys, afterKeys)),
    });
};
