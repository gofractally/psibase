import { z } from "zod";

export const zMetadata = z.object({
    name: z.string().max(30),
    shortDesc: z.string().max(100),
    longDesc: z.string().max(1000),
    icon: z.string(), // Base64 string
    iconMimeType: z.string(), // MIME type of the icon
    tags: z.string().array().max(3),
});

export const zPath = z.string().transform((path) => {
    const normalizedPath = path.replace(/\/+/g, "/");
    const cleanPath = normalizedPath.startsWith("/")
        ? normalizedPath.slice(1)
        : normalizedPath;
    const trimmedPath = cleanPath.endsWith("/")
        ? cleanPath.slice(0, -1)
        : cleanPath;
    return "/" + trimmedPath;
});
