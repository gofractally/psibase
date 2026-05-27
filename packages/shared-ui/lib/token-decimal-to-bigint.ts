import { tokens } from "./plugins";
import { callPluginFunction } from "./plugins/index";

export async function tokenDecimalToBigInt(
    tokenId: number,
    decimalAmount: string,
): Promise<bigint> {
    const raw = await callPluginFunction(tokens.helpers.decimalToU64, [
        tokenId,
        decimalAmount,
    ]);
    return typeof raw === "bigint" ? raw : BigInt(raw);
}
