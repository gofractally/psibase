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

function emptyService(s: ServiceConfig) {
    return s.host == "" && s.root == "";
}

export const Service = ({
    register,
    getValues,
    index,
    services,
}: ServiceProps) => {
    const isEnd = index == services.fields.length - 1;
    const fixLastRow = (e: any) => {
        if (index == services.fields.length - 1) {
            services.append(
                { host: "", root: "", key: newId() },
                { shouldFocus: false }
            );
        } else if (
            index == services.fields.length - 2 &&
            emptyService(services.fields.at(-1)!) &&
            emptyService(getValues())
        ) {
            services.remove(services.fields.length - 1);
        }
    };
    return (
        <tr className="w-full">
            <td>
                <Input
                    {...register(`${index}.host`, { onChange: fixLastRow })}
                />
            </td>
            <td>
                <Input
                    {...register(`${index}.root`, { onChange: fixLastRow })}
                />
            </td>
            {!isEnd && (
                <td>
                    <Button
                        variant="secondary"
                        onClick={() => services.remove(index)}
                    >
                        Remove
                    </Button>
                </td>
            )}
        </tr>
    );
};

export default Service;
