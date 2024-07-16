import { useGraphana, url } from "../hooks/useGraphana";

interface Props {
    url: string;
}

const Graphana = ({ url }: Props) => {
    return (
        <iframe
            src={url}
            style={{ overflow: "hidden", height: "100%", width: "100%" }}
            height="100%"
            width="100%"
        />
    );
};

export const DashboardPage = () => {
    const { isSuccess } = useGraphana();

    return (
        <div>
            <h2 className="scroll-m-20  pb-2 text-3xl font-semibold tracking-tight ">
                Dashboard
            </h2>
            {isSuccess && <Graphana url={url} />}
        </div>
    );
};
