import { queryKeys } from "@/lib/queryKeys";

import { Schema, UrlForm } from "../../components/forms/url";
import { useToast } from "../../components/ui/use-toast";
import { useConnect } from "../../hooks/useConnect";
import { queryClient } from "../../main";

interface Props {
    onConnection: () => void;
}

export const SmartConnectForm = ({ onConnection }: Props) => {
    const { mutateAsync: connect } = useConnect();
    const { toast } = useToast();

    const onSubmit = async (data: Schema) => {
        const res = await connect(data);
        queryClient.invalidateQueries({ queryKey: queryKeys.config });
        toast({
            title: "Success",
            description: `Connected to ${
                res.newPeer.url || res.newPeer.endpoint
            }.`,
        });
        onConnection();
    };

    return <UrlForm onSubmit={onSubmit} />;
};
