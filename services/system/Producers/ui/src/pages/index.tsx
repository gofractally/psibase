import { ProducersForm } from "@/components/forms/producers-form";
import { useSetProducers } from "../hooks/useSetProducers";
import { Nav } from "../components/nav";

export const Home = () => {
  const { mutateAsync: setProducers } = useSetProducers();

  return (
    <div className="max-w-2xl mx-auto mt-4">
      <Nav />
      <ProducersForm onSubmit={setProducers} />
    </div>
  );
};
