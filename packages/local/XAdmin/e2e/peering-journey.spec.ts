import { expect, test } from "./fixtures/admin-browser";
import { createNetworkThroughUi } from "./lib/create-network-ui";
import {
    waitForChain,
    waitForHeadBlock,
    waitForSync,
} from "./lib/node-ready";

const PRODUCER = "prod";
const JOIN_TIMEOUT_MS = 180_000;
const BOOT_TIMEOUT_MS = 180_000;

test("two joiners peer to a UI-booted producer through the admin UI", async ({
    startPsinode,
    openAdmin,
}) => {
    test.setTimeout(BOOT_TIMEOUT_MS + JOIN_TIMEOUT_MS * 2 + 60_000);

    const producer = await startPsinode({ nodeIndex: 0, producer: PRODUCER });
    const producerAdmin = `http://x-admin.psibase.localhost:${producer.port}`;
    const { page: producerPage, errors: producerErrors } =
        await openAdmin(producer);
    await createNetworkThroughUi(
        producerPage,
        producerAdmin,
        PRODUCER,
        "Development",
    );
    await waitForChain(producer.socketPath, BOOT_TIMEOUT_MS);
    await waitForHeadBlock(producer.socketPath, BOOT_TIMEOUT_MS);
    producerErrors.assertEmpty();

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

        await page.goto(`${adminUrl}/`);
        await page.getByRole("button", { name: "Join network" }).click();
        await page.getByPlaceholder("URL").fill(peerUrl);
        await page.getByRole("button", { name: "Connect" }).click();
        await expect(
            page.getByRole("region", { name: /Notifications/ }),
        ).toContainText("Connected to");

        await waitForChain(joiner.socketPath, JOIN_TIMEOUT_MS);
        await waitForSync(
            joiner.socketPath,
            producer.socketPath,
            JOIN_TIMEOUT_MS,
        );

        // Dashboard polls while needgenesis clears; Chromium logs those 401/404
        // loads. Only assert on the peers page after sync.
        errors.clear();
        await page.goto(`${adminUrl}/#/peers`);
        await expect(
            page.getByRole("row").filter({ hasText: producerEndpoint }),
        ).toBeVisible();
        await page.waitForLoadState("networkidle");
        errors.assertEmpty();
    }
});
