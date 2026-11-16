import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CreateThreadModal } from "@/components/modals/create-thread-modal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

const CreateThreadContext = createContext<() => void>(() => {});

export const useOpenCreateThread = () => useContext(CreateThreadContext);

export const CreateThreadHost = ({ children }: { children: React.ReactNode }) => {
    const [show, setShow] = useState(false);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const fractal = useFractalAccount();

    return (
        <CreateThreadContext.Provider value={() => setShow(true)}>
            {children}
            <CreateThreadModal
                show={show}
                openChange={setShow}
                onCreated={(account) => {
                    void queryClient.invalidateQueries({
                        queryKey: ["social-threads", fractal],
                    });
                    void queryClient.invalidateQueries({
                        queryKey: ["social-ranked", fractal],
                    });
                    navigate(`/threads/${account}`);
                }}
            />
        </CreateThreadContext.Provider>
    );
};
