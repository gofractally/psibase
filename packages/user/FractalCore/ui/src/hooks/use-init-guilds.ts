import { useFractal } from "./fractals/use-fractal"
import { useMigrateGuilds } from "./fractals/use-migrate-guilds";
// import { useSetRoleMapping } from "./fractals/use-set-role-mapping";
// import { useSetRoleOccupation } from "./fractals/use-set-role-occupation";


// const LEGISTLATURE = 1;
// const JUDICIARY = 2;
// const EXECUTIVE = 3;

export const useInitGuilds = () => {


    const { data: fractal, isSuccess } = useFractal();

    const shouldInitialise = isSuccess && fractal?.fractal?.legislature.occupation === 'de-facto';

    const { mutateAsync: migrateGuilds, isIdle } = useMigrateGuilds()

    console.log({ isSuccess, shouldInitialise, fractal })
    if (shouldInitialise && isIdle) {
        migrateGuilds(['genesisguil'])
    }
}