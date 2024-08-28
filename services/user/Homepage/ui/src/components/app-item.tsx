import { siblingUrl } from "@psibase/common-lib";

import { PinContainer } from "@/components/ui/3d-pin";

interface Props {
    service: string;
    description: string;
    name: string;
}

export const AppItem = ({ service, description, name }: Props) => {
    const url = siblingUrl(null, service, null, false);
    const title = `${service}.${new URL(window.location.href).hostname.replace(
        ".127.0.0.1.sslip.io",
        ".io"
    )}`;

    return (
        <div className="flex h-[16rem] w-full items-center justify-center">
            <a href={url}>
                <PinContainer title={title.toString()} href={url}>
                    <div className="flex h-[20rem] w-[20rem] basis-full flex-col justify-center  p-4 tracking-tight text-slate-100/50 sm:basis-1/2 ">
                        <h3 className="!m-0 max-w-xs !pb-2 text-base  font-bold text-slate-100">
                            {name}
                        </h3>
                        <div className="!m-0 !p-0 text-base font-normal">
                            <span className="text-slate-500 ">
                                {description}
                            </span>
                        </div>
                        <div className="mt-4 flex w-full flex-1 rounded-lg bg-gradient-to-br from-violet-500 via-purple-500 to-blue-500" />
                    </div>
                </PinContainer>
            </a>
        </div>
    );
};
