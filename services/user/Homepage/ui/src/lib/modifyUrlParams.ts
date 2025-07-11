/**
 * Modifies URL parameters by adding or updating query parameters in the given URL
 *
 * @param url - The original URL string to modify
 * @param params - An object containing key-value pairs of query parameters to set
 * @returns The modified URL string with updated query parameters
 *
 * @example
 * // Add or update 'page' parameter
 * modifyUrlParams('https://example.com', { page: '2' })
 * // Returns: 'https://example.com?page=2'
 *
 * // Update multiple parameters
 * modifyUrlParams('https://example.com?page=1', { page: '2', sort: 'desc' })
 * // Returns: 'https://example.com?page=2&sort=desc'
 */
export const modifyUrlParams = (
    url: string,
    params: { [key: string]: string },
): string => {
    const urlObject = new URL(url);

    const parsObject = new URLSearchParams(urlObject.search);

    Object.entries(params).forEach(([key, value]) => {
        parsObject.set(key, value);
    });

    urlObject.search = parsObject.toString();

    return urlObject.toString();
};
