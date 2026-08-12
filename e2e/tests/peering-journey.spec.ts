import { expect, test } from "../fixtures/admin-browser";
import { waitForChain, waitForSync } from "../lib/node-ready";

const PRODUCER = "prod";
const JOIN_TIMEOUT_MS = 60_000;

test("two joiners peer to a booted producer through the admin UI", async ({
    startPsinode,
    bootChain,
    openAdmin,
}) => {
    // Three nodes, a boot, and two joins do not fit the 30s default.
    test.setTimeout(120_000);

    const producer = await startPsinode({ nodeIndex: 0, producer: PRODUCER });
    await bootChain({ socketPath: producer.socketPath, producer: PRODUCER });

    // psinode dials "x-peers." + this URL's host, so the peer URL names a host
    // that resolves for psinode itself. The browser never fetches it.
    const peerUrl = `http://psibase.localhost:${producer.port}/`;
    // .localhost resolves to loopback for psinode; the peers table shows that address.
    const producerEndpoint = `127.0.0.1:${producer.port}`;

    // A joiner starts without -p and never boots. Peering is independent of
    // consensus membership, so it never has to join the active producer set.
    for (const nodeIndex of [1, 2]) {
        const joiner = await startPsinode({ nodeIndex });
        const adminUrl = `http://x-admin.psibase.localhost:${joiner.port}`;
        const { page, errors } = await openAdmin(joiner);

        // An unbooted node reports needgenesis, which forces the UI to setup.
        await page.goto(`${adminUrl}/`);
        await page.getByRole("button", { name: "Join network" }).click();
        await page.getByPlaceholder("URL").fill(peerUrl);
        await page.getByRole("button", { name: "Connect" }).click();
        await expect(
            page.getByRole("region", { name: /Notifications/ }),
        ).toContainText("Connected to");

        // Status is the dependable sync signal for having adopted the chain.
        await waitForChain(joiner.socketPath, JOIN_TIMEOUT_MS);
        await waitForSync(joiner.socketPath, producer.socketPath, JOIN_TIMEOUT_MS);

        // The loaded app polls status every 10s, so it still has needgenesis
        // cached and redirects to setup; reload before routing to peers.
        await page.reload();
        await page.goto(`${adminUrl}/#/peers`);
        await expect(
            page.getByRole("row").filter({ hasText: producerEndpoint }),
        ).toBeVisible();
        await page.waitForLoadState("networkidle");
        errors.assertEmpty();
    }
});
