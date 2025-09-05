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
