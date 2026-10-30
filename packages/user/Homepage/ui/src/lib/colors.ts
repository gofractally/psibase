/** Deterministic, pleasant color for an arbitrary label (account, token, ...). */
export const colorFor = (label: string, saturation = 70, lightness = 58) => {
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
        hash = (hash * 31 + label.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
};
