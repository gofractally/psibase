import { AppRegistryFormData } from "@components/app-registry-form";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDate(input: string | number): string {
    const date = new Date(input);
    return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

export function debounce<T extends (...args: any[]) => any>(
    cb: T,
    wait: number,
) {
    let h: any;
    const callable = (...args: any) => {
        clearTimeout(h);
        h = setTimeout(() => cb(...args), wait);
    };
    return <T>(<any>callable);
}

export async function mockSubmitToAPI(
    data: AppRegistryFormData,
    successMessage: string,
    accountId: string,
    id?: string,
) {
    console.log("mockSubmitToAPI started", {
        data,
        successMessage,
        accountId,
        id,
    });

    try {
        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("API delay simulated");

        // Get existing apps
        const existingApps = JSON.parse(
            localStorage.getItem("registeredApps") || "[]",
        );
        console.log("Existing apps retrieved", existingApps);

        let iconBase64 = null;
        if (id) {
            // ... (existing code for updating)
        }

        // Only process new icon if it's provided
        if (data.icon instanceof File) {
            console.log("Processing new icon");
            iconBase64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    console.log("Icon read complete");
                    resolve(reader.result as string);
                };
                reader.readAsDataURL(data.icon as Blob);
            });
        }

        // Prepare data for storage
        const appData = {
            ...data,
            icon: iconBase64,
            id: id || Date.now().toString(),
            accountId,
        };
        console.log("App data prepared", appData);

        if (id) {
            // ... (existing code for updating)
        } else {
            console.log("Adding new app");
            existingApps.push(appData);
        }

        try {
            localStorage.setItem(
                "registeredApps",
                JSON.stringify(existingApps),
            );
            console.log("Apps saved to localStorage");
        } catch (storageError) {
            if (
                storageError instanceof DOMException &&
                storageError.name === "QuotaExceededError"
            ) {
                console.error(
                    "Storage quota exceeded. Trying to remove oldest app.",
                );
                if (existingApps.length > 1) {
                    existingApps.shift(); // Remove the oldest app
                    localStorage.setItem(
                        "registeredApps",
                        JSON.stringify(existingApps),
                    );
                    console.log("Oldest app removed and new data saved.");
                } else {
                    throw new Error(
                        "Cannot save new app. Storage is full and no old apps to remove.",
                    );
                }
            } else {
                throw storageError; // Re-throw if it's a different error
            }
        }

        console.log("mockSubmitToAPI completed successfully");
        return { success: true, message: successMessage };
    } catch (error) {
        console.error("Error in mockSubmitToAPI:", error);
        throw error;
    }
}
