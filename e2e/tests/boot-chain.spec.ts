import { expect, test } from "../fixtures/psinode";

test("booted node reports empty status", async ({ startPsinode, bootChain }) => {
    const producer = "prod";
    const node = await startPsinode({ nodeIndex: 0, producer });

    const before = await node.socketGet("/native/admin/status");
    expect(before.statusCode).toBe(200);
    expect(JSON.parse(before.body)).toEqual(["needgenesis"]);

    await bootChain({ socketPath: node.socketPath, producer });

    const after = await node.socketGet("/native/admin/status");
    expect(after.statusCode).toBe(200);
    expect(JSON.parse(after.body)).toEqual([]);
});
