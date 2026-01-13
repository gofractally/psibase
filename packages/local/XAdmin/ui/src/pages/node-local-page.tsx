import { NodeLocalPackages } from "../configuration/node-local-packages";

export const NodeLocalPage = () => {
    return (
        <div className="p-4">
            <h1 className="mb-6 scroll-m-20 text-4xl font-extrabold tracking-tight">
                Packages
            </h1>
            <NodeLocalPackages />
        </div>
    );
};

