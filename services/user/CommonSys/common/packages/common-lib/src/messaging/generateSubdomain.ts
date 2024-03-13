export const generateSubdomain = (subDomain?: string): string => {
    const currentUrl = new URL(window.location.href);
    const hostnameParts = currentUrl.hostname.split(".");

    hostnameParts.shift();
    if (subDomain) {
        hostnameParts.unshift(subDomain);
    }
    currentUrl.hostname = hostnameParts.join(".");

    return currentUrl.origin;
};
