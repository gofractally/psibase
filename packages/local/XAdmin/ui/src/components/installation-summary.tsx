import { RowSelectionState } from "@tanstack/react-table";
import { Info } from "lucide-react";

import { ConfirmationForm } from "@/components/forms/confirmation-form";

import { PackageInfo } from "@/types";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@shared/shadcn/ui/accordion";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@shared/shadcn/ui/popover";

import { type BootTemplate } from "../hooks/use-templated-packages";
import { useKeyDevices } from "../hooks/use-key-devices";

interface ChipProps {
    label: string;
    value: string;
    hint?: string;
}

const Chip = ({ label, value, hint }: ChipProps) => (
    <div className="w-60 truncate rounded-md border p-2 text-right">
        <div className="text-muted-foreground text-sm">{label}</div>
        <div className="flex items-center justify-end space-x-1">
            <div>{value}</div>
            {hint ? (
                <Popover>
                    <PopoverTrigger>
                        <Info size={16} />
                    </PopoverTrigger>
                    <PopoverContent>{hint}</PopoverContent>
                </Popover>
            ) : null}
        </div>
    </div>
);

interface Props {
    template: BootTemplate;
    bpName: string;
    keyDevice: string;
    rows: RowSelectionState;
    setRows: React.Dispatch<React.SetStateAction<RowSelectionState>>;
    packages: PackageInfo[];
}

const templateLabel: Record<BootTemplate, string> = {
    dev: "Developer",
    prod: "Production",
    priv: "Private",
};

const accountTypeHint: Record<BootTemplate, string> = {
    dev: "Creating a network with the Development template creates your account in an insecure keyless mode. The account is automatically imported into the accounts app in the current device's web browser.",
    prod: "Creating a network with the Production template automatically generates a keypair for your account. The account is automatically imported into the accounts app in the current device's web browser.",
    priv: "Creating a network with the Private template automatically generates a keypair for your account. The account is automatically imported into the accounts app in the current device's web browser.",
};

export const InstallationSummary = ({
    template,
    bpName,
    keyDevice,
    rows,
    setRows,
    packages,
}: Props) => {
    const { data: keyDevices } = useKeyDevices();
    const selectedDevice = keyDevices?.find((d) => d.id === keyDevice);
    const isDev = template === "dev";
    return (
        <div>
            <div className="grid grid-cols-1 gap-6 py-2 sm:grid-cols-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Installation summary
                </h1>
                <div className="flex flex-row-reverse ">
                    <div className="flex flex-col gap-3  ">
                        <Chip
                            label="Template"
                            value={templateLabel[template]}
                        />
                        <Chip label="Block Producer Name" value={bpName} />
                        <Chip
                            label="Account Type"
                            value={isDev ? "Insecure" : "Secure"}
                            hint={accountTypeHint[template]}
                        />
                        {isDev ? null : (
                            <Chip
                                label="Key Device"
                                value={selectedDevice?.name ?? "⚠️ error"}
                            />
                        )}
                    </div>
                </div>
            </div>
            <div className="max-h-full ">
                <Accordion type="single" collapsible>
                    <AccordionItem value="item-1">
                        <AccordionTrigger className="w-60">
                            Advanced
                        </AccordionTrigger>
                        <AccordionContent>
                            <ConfirmationForm
                                rowSelection={rows}
                                onRowSelectionChange={setRows}
                                packages={packages}
                            />
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </div>
    );
};
