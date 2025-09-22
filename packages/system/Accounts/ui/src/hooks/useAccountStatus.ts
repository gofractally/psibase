import { supervisor } from "@/main";
import { z } from "zod";

const GetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

export const assertAccountAvailable = async (
    accountName: string,
): Promise<true> => {
    try {
        const res = GetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        if (res) {
            throw new Error("Taken");
        }

        return true;
    } catch (e) {
        if (e instanceof Error && e.message === "Taken") {
            throw e;
        }
        throw new Error("Invalid");
    }
};
