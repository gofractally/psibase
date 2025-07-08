/* eslint-disable @typescript-eslint/no-explicit-any */
import { RegisterOptions } from "react-hook-form";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";

type ServiceConfig = {
    host: string;
    root: string;
};

export type ServiceProps = {
    register: (
        name: `${number}.root` | `${number}.host` | `${number}.key`,
        options?: RegisterOptions
    ) => any;
    getValues: () => ServiceConfig;
    index: number;
    services: any;
};

export const Service = ({ register, index, services }: ServiceProps) => {
    return (
        <tr className="w-full">
            <td>
                <Input {...register(`${index}.host`)} />
            </td>
            <td>
                <Input {...register(`${index}.root`)} />
            </td>
            <td>
                <Button
                    variant="secondary"
                    onClick={() => services.remove(index)}
                >
                    Remove
                </Button>
            </td>
        </tr>
    );
};

export default Service;
