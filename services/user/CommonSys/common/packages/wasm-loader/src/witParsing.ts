export type ServiceMethodIndex = {
    [k: string]: string[];
};

const stripGenerated = (lines: string[]) => {
    let startingIndex = -1;
    let endingIndex = -1;

    lines.forEach((line, index) => {
        if (line.startsWith("package component:")) {
            startingIndex = index;
        } else {
            if (startingIndex != -1 && endingIndex == -1) {
                if (line.startsWith("package ")) {
                    endingIndex = index;
                }
            }
        }
    });
    return lines.slice(startingIndex, endingIndex);
};

const groupInterfaces = (lines: string[]) => {
    let obj: { [key: string]: string[] } = {};
    let isOpen = false;
    let currentName = "";
    lines.forEach((line) => {
        if (line.startsWith("interface ")) {
            isOpen = true;
            currentName = line.split(" ")[1];
        } else if (line == "}") {
            isOpen = false;
        } else if (isOpen) {
            obj[currentName] = obj[currentName]
                ? [...obj[currentName], line]
                : [line];
        }
    });

    return obj;
};

export const parseFunctions = (data: string): ServiceMethodIndex => {
    const lines = data.split("\n").map((x) => x.trim());
    const newLines = stripGenerated(lines);

    const interfaces = groupInterfaces(newLines);
    const entries = Object.fromEntries(
        Object.entries(interfaces).map(([key, value]): [string, string[]] => [
            key,
            value.map((v) => v.split(" ")[0].slice(0, -1))
        ])
    );

    return entries;
};
