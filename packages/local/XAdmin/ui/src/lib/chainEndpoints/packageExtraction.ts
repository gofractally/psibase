import JSZip from "jszip";

export interface PackageMeta {
    sha256: string;
    [key: string]: unknown;
}

export interface ExtractedPackage {
    zip: JSZip;
    services: string[];
    meta: PackageMeta;
    sha256: string;
}

/**
 * Extract service names from the zip package
 */
export function extractServicesFromZip(zip: JSZip): string[] {
    const services: string[] = [];
    zip.folder("service")?.forEach((relativePath) => {
        if (relativePath.endsWith(".wasm")) {
            const serviceName = relativePath.replace(".wasm", "");
            services.push(serviceName);
        }
    });
    return services;
}

/**
 * Validate that all services have the x- prefix (node-local requirement)
 */
export function validateNodeLocalServices(services: string[]): void {
    const invalidServices = services.filter((name) => !name.startsWith("x-"));
    if (invalidServices.length > 0) {
        throw new Error(
            `Invalid service name(s): ${invalidServices.join(", ")}. ` +
                `Only node-local services with "x-" prefix can be installed via this method.`,
        );
    }
}

/**
 * Load and parse meta.json from the package
 */
export async function loadPackageMeta(zip: JSZip): Promise<Record<string, unknown>> {
    const metaJsonFile = zip.file("meta.json");
    if (!metaJsonFile) {
        throw new Error("meta.json file not found in package");
    }
    const metaText = await metaJsonFile.async("text");
    return JSON.parse(metaText);
}

/**
 * Compute SHA256 hash of the package file
 */
export async function computePackageSha256(file: File): Promise<string> {
    const fileArrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", fileArrayBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Extract and prepare package data from a File
 */
export async function extractPackage(file: File): Promise<ExtractedPackage> {
    const zip: JSZip = await JSZip.loadAsync(file);
    const services = extractServicesFromZip(zip);
    validateNodeLocalServices(services);
    const metaJson = await loadPackageMeta(zip);
    const sha256 = await computePackageSha256(file);
    
    const meta: PackageMeta = {
        ...metaJson,
        sha256,
    };

    return {
        zip,
        services,
        meta,
        sha256,
    };
}

export interface ManifestPayload {
    services: Array<Record<string, unknown>>;
    data: Array<{ account: string; filename: string }>;
}

/**
 * Build the complete manifest payload (services + data)
 */
export async function buildManifestPayload(
    zip: JSZip,
    serviceNames: string[],
): Promise<ManifestPayload> {
    // Build services array
    const services = await Promise.all(
        serviceNames.map(async (serviceName) => {
            const serviceJsonFile = zip.file(`service/${serviceName}.json`);
            if (!serviceJsonFile) {
                throw new Error(`Service ${serviceName} .json file not found in package`);
            }
            return {
                [serviceName]: JSON.parse(await serviceJsonFile.async("text")),
            };
        }),
    );

    // Build data array
    const dataDir = zip.folder("data");
    const data: Array<{ account: string; filename: string }> = [];
    
    if (dataDir) {
        dataDir.forEach((relativePath, file) => {
            if (!file.dir) {
                // Format: <servicename>/<filepath>
                const firstSlash = relativePath.indexOf("/");
                if (firstSlash === -1) {
                    console.warn(`Invalid data file path: ${relativePath}`);
                    return;
                }
                const account = relativePath.substring(0, firstSlash);
                const filename = relativePath.substring(firstSlash);
                data.push({ account, filename });
            }
        });
    }

    return { services, data };
}
