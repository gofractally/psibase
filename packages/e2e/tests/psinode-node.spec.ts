import http from "node:http";
import { getRoutableIPv4 } from "../lib/routable-address";
import { expect, test } from "../fixtures/psinode";

function tcpRequest(options: {
    host: string;
    port: number;
    path: string;
    hostHeader: string;
    authorization?: string;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            Host: options.hostHeader,
        };
        if (options.authorization !== undefined) {
            headers.Authorization = options.authorization;
        }
        const req = http.request(
            {
                host: options.host,
                port: options.port,
                method: "GET",
                path: options.path,
                headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    resolve({
                        statusCode: res.statusCode ?? 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString("utf8"),
                    });
                });
            },
        );
        req.on("error", reject);
        req.end();
    });
}

test("fresh psinode reports needgenesis and enforces Basic auth on TCP", async ({
    startPsinode,
}) => {
    const node = await startPsinode({ nodeIndex: 0 });
    const routable = getRoutableIPv4();
    const adminHost = "x-admin.psibase.localhost";

    const status = await node.socketGet("/native/admin/status");
    expect(status.statusCode).toBe(200);
    expect(JSON.parse(status.body)).toEqual(["needgenesis"]);

    const unauthenticated = await tcpRequest({
        host: routable,
        port: node.port,
        path: "/native/admin/status",
        hostHeader: adminHost,
    });
    expect(unauthenticated.statusCode).toBe(401);
    const challenge = unauthenticated.headers["www-authenticate"];
    expect(typeof challenge).toBe("string");
    expect(challenge).toMatch(/^Basic /);

    const credentials = Buffer.from(`${node.username}:${node.password}`).toString(
        "base64",
    );
    const authenticated = await tcpRequest({
        host: routable,
        port: node.port,
        path: "/native/admin/status",
        hostHeader: adminHost,
        authorization: `Basic ${credentials}`,
    });
    expect(authenticated.statusCode).toBe(200);
    expect(JSON.parse(authenticated.body)).toEqual(["needgenesis"]);

    expect(node.child.pid).toBeDefined();
    expect(node.child.exitCode).toBeNull();
});
