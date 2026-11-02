/**
 * Create network wizard. Development needs no security device. Private /
 * Production need SoftHSM on the psinode fixture (see test_boot_with_key).
 */
import { test } from "./fixtures/admin-browser";
import { createNetworkThroughUi } from "./lib/create-network-ui";
import { waitForChain } from "./lib/node-ready";

const PRODUCER = "prod";
const BOOT_TIMEOUT_MS = 180_000;

test("create network boots Development through the admin UI", async ({
    startPsinode,
    openAdmin,
}) => {
    test.setTimeout(BOOT_TIMEOUT_MS);

    const node = await startPsinode({ nodeIndex: 0, producer: PRODUCER });
    const adminUrl = `http://x-admin.psibase.localhost:${node.port}`;
    const { page, errors } = await openAdmin(node);

    await createNetworkThroughUi(page, adminUrl, PRODUCER, "Development");
    await waitForChain(node.socketPath, BOOT_TIMEOUT_MS);
    errors.assertEmpty();
});

test("create network boots Private through the admin UI", async ({
    startPsinode,
    openAdmin,
}) => {
    test.setTimeout(BOOT_TIMEOUT_MS);

    const node = await startPsinode({
        nodeIndex: 0,
        producer: PRODUCER,
        softhsm: true,
    });
    const adminUrl = `http://x-admin.psibase.localhost:${node.port}`;
    const { page, errors } = await openAdmin(node);

    await createNetworkThroughUi(page, adminUrl, PRODUCER, "Private");
    await waitForChain(node.socketPath, BOOT_TIMEOUT_MS);
    errors.assertEmpty();
});
