import { siblingUrl } from "@psibase/common-lib";
import type { PackageMeta, ManifestPayload } from "./packageExtraction";

/**
 * Call the preinstall API endpoint
 */
export async function callPreinstall(meta: PackageMeta): Promise<void> {
    const response = await fetch(`${siblingUrl(null, "x-packages", "/preinstall")}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(meta),
    });

    if (!response.ok) {
        throw new Error(`Failed to install package: ${response.status} ${response.statusText}`);
    }
}

/**
 * Call the manifest API endpoint
 */
export async function installManifest(
    sha256: string,
    payload: ManifestPayload,
): Promise<void> {
    const response = await fetch(`${siblingUrl(null, "x-packages", "/manifest")}/${sha256.toUpperCase()}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Failed to install package: ${response.status} ${response.statusText}`);
    }
}

/**
 * Call the postinstall API endpoint
 */
export async function callPostinstall(meta: PackageMeta): Promise<void> {
    const response = await fetch(`${siblingUrl(null, "x-packages", "/postinstall")}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(meta),
    });

    if (!response.ok) {
        throw new Error(`Failed to install package: ${response.status} ${response.statusText}`);
    }
}
