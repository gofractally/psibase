import os from "node:os";

export function getRoutableIPv4(): string {
    for (const addresses of Object.values(os.networkInterfaces())) {
        if (!addresses) {
            continue;
        }
        for (const address of addresses) {
            if (address.family === "IPv4" && !address.internal) {
                return address.address;
            }
        }
    }
    throw new Error("No non-internal IPv4 address found on this host");
}
