import { Con } from "components/layouts/con";
import { useFractal } from "hooks/useParticipatingFractals";
import { useParams } from "react-router-dom";

export const Home = () => {
    const { fractalID } = useParams();
    const { data } = useFractal(fractalID);

    return (
        <Con title="Home">
            <p>This is the home page</p>
        </Con>
    );
};
