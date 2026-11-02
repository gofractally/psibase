import http from "node:http";

export type SocketRequestOptions = {
    socketPath: string;
    host: string;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};

export function socketRequest(
    options: SocketRequestOptions,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                socketPath: options.socketPath,
                method: options.method ?? "GET",
                path: options.path,
                headers: {
                    Host: options.host,
                    ...options.headers,
                },
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
        if (options.body !== undefined) {
            req.write(options.body);
        }
        req.end();
    });
}
