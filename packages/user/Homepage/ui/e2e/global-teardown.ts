import {
    forceReleaseE2eChainPort,
    removeE2eRunLock,
} from "./lib/chain-boot";

async function globalTeardown(): Promise<void> {
    removeE2eRunLock();
    await forceReleaseE2eChainPort();
}

export default globalTeardown;
