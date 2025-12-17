import { updateFractalCache } from "@/hooks/fractals/use-fractal";
import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { fractalCorePlugin } from "@/lib/plugin";

export const useSetMinScorers = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.setMinScorers, {
        loading: "Setting minimum scorers..",
        success: "Set minimum scorers",
        onSuccess: ([minimumRequiredScorers]) => {
            updateFractalCache((old) => {
                if (!old?.fractal) {
                    return old;
                }

                return {
                    ...old,
                    fractal: {
                        ...old.fractal,
                        minimumRequiredScorers,
                    },
                };
            });
        },
    });
