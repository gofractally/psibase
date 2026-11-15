import { MessagesSquare, MoreHorizontal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { getRankedThreads } from "@/lib/social";

import { Menu } from "@/components/nav/menu";

const TOP = 5;

export const SocialMenu = () => {
    const fractal = useFractalAccount();
    const ranked = useQuery({
        queryKey: ["social-ranked", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getRankedThreads(fractal!),
    });
    const top = (ranked.data ?? []).slice(0, TOP);

    return (
        <Menu.Item title="Social" Icon={MessagesSquare}>
            {top.map((thread) => (
                <Menu.SubItem
                    key={thread.account}
                    title={thread.title}
                    path={`/threads/${thread.account}`}
                    Icon={MessagesSquare}
                />
            ))}
            <Menu.SubItem title="More..." path="/threads" Icon={MoreHorizontal} />
        </Menu.Item>
    );
};
