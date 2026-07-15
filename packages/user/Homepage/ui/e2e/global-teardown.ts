import {
    forceReleaseE2eChainPort,
    removeE2eRunLock,
} from "./lib/chain-boot";

async function globalTeardown(): Promise<void> {
    removeE2eRunLock();
    if (process.env.PSIBASE_E2E_EXTERNAL_CHAIN === "1") {
        return;
    }
    await forceReleaseE2eChainPort();
}

export default globalTeardown;
