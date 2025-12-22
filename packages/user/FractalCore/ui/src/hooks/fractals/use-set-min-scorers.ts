import { updateFractalCache } from "@/hooks/fractals/use-fractal";
import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { fractalCorePlugin } from "@/lib/plugin";

export const useSetTokenThreshold = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.setTokenThreshold, {
        loading: "Setting token threshold..",
        success: "Set token threshold",
        onSuccess: ([threshold]) => {
            updateFractalCache((old) => {
                if (!old?.fractal) {
                    return old;
                }

                return {
                    ...old,
                    fractal: {
                        ...old.fractal,
                        tokenInitThreshold: threshold,
                    },
                };
            });
        },
    });
