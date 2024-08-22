import { RegisterOptions } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { newId } from "../configuration/utils";
import { Input } from "./ui/input";

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
