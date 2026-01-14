import JSZip from "jszip";
import { lookup } from "mrmime";
import { siblingUrl } from "@psibase/common-lib";

/**
 * Install a single service from the package
 */
export async function installService(
    zip: JSZip,
    serviceName: string,
): Promise<void> {
    const wasmFile = zip.file(`service/${serviceName}.wasm`);
    const jsonMetaFile = zip.file(`service/${serviceName}.json`);
    
    if (!wasmFile || !jsonMetaFile) {
        throw new Error(
            `Service ${serviceName} .wasm or .json file not found in package`,
        );
    }

    const wasmData = await wasmFile.async("arraybuffer");
    const response = await fetch(`/services/${serviceName}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/wasm",
        },
        body: wasmData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Failed to install service ${serviceName}: ${response.status} ${errorText}`,
        );
    }
}

/**
 * Install all services from the package
 */
export async function installAllServices(
    zip: JSZip,
    serviceNames: string[],
): Promise<string[]> {
    const installed: string[] = [];
    
    for (const serviceName of serviceNames) {
        await installService(zip, serviceName);
        installed.push(serviceName);
    }
    
    return installed;
}

/**
 * Install data files from the package
 */
export async function installDataFiles(zip: JSZip): Promise<void> {
    const dataDir = zip.folder("data");
    if (dataDir) {
        const dataFilePromises: Array<{ path: string; data: Promise<ArrayBuffer> }> = [];

        dataDir.forEach((relativePath, file) => {
            if (!file.dir) {
                dataFilePromises.push({
                    path: relativePath,
                    data: file.async("arraybuffer"),
                });
            }
        });

        const resolvedDataFiles = await Promise.all(
            dataFilePromises.map(async (item) => {
                const data = await item.data;
                return { path: item.path, data };
            }),
        );

        // Data files are stored as: data/<service><path>
        for (const { path, data } of resolvedDataFiles) {
            // Format: <servicename>/<filepath>
            const firstSlash = path.indexOf("/");
            if (firstSlash === -1) {
                console.warn(`Invalid data file path: ${path}`);
                continue;
            }
            const serviceName = path.substring(0, firstSlash);
            const filePath = path.substring(firstSlash);

            const contentType = lookup(filePath) || "application/octet-stream";

            // PUT directly to the service's subdomain
            const url = siblingUrl(null, serviceName, filePath);
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    "Content-Type": contentType,
                },
                body: data,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Failed to upload data file ${filePath} to ${serviceName}: ${response.status} ${errorText}`,
                );
            }
        }
    }
}
