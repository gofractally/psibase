import { writeFileSync } from "node:fs";

import {
    assertNoConcurrentE2eRun,
    bootFreshChain,
    chainStateFile,
    forceReleaseE2eChainPort,
    isPortBound,
    writeE2eRunLock,
} from "./lib/chain-boot";

/**
 * Boot a fresh chain for the run. The handle is serialized to a temp file so
 * `globalTeardown` can find and kill the same psinode pid even when Playwright
 * spawns separate processes for setup and teardown.
 */
async function globalSetup(): Promise<void> {
    assertNoConcurrentE2eRun();
    await forceReleaseE2eChainPort();

    const externallyManaged =
        process.env.PSIBASE_E2E_EXTERNAL_CHAIN === "1";

    if (externallyManaged) {
        const host =
            process.env.PSIBASE_E2E_BROWSER_HOST ??
            process.env.PSIBASE_E2E_HOST ??
            "network.psibase.localhost";
        const port = Number(process.env.PSIBASE_E2E_PORT ?? "8080");
        if (!(await isPortBound("127.0.0.1", port))) {
            throw new Error(
                `PSIBASE_E2E_EXTERNAL_CHAIN=1 was set, but no chain is listening on 127.0.0.1:${port}.`,
            );
        }
        const baseUrl = `http://${host}:${port}/`;
        writeFileSync(
            chainStateFile(),
            JSON.stringify(
                { external: true, host, port, baseUrl },
                null,
                2,
            ),
        );
        writeE2eRunLock({
            ownerPid: process.pid,
            startedAt: new Date().toISOString(),
        });
        return;
    }

    const handle = await bootFreshChain();
    writeFileSync(
        chainStateFile(),
        JSON.stringify(
            {
                external: false,
                host: handle.host,
                port: handle.port,
                baseUrl: handle.baseUrl,
                dbDir: handle.dbDir,
                psinodePid: handle.psinodePid,
                psinodeLog: handle.psinodeLog,
            },
            null,
            2,
        ),
    );
    writeE2eRunLock({
        ownerPid: process.pid,
        startedAt: new Date().toISOString(),
        psinodePid: handle.psinodePid,
        psinodeLog: handle.psinodeLog,
    });
}

export default globalSetup;
