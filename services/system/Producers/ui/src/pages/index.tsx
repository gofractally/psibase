import { ProducersForm } from "@/components/forms/producers-form";

import { Nav } from "../components/nav";
import { useSetProducers } from "../hooks/useSetProducers";

export const Home = () => {
    const { mutateAsync: setProducers } = useSetProducers();

    return (
        <div className="mx-auto mt-4 max-w-2xl">
            <Nav />
            <ProducersForm onSubmit={setProducers} />
        </div>
    );
};
