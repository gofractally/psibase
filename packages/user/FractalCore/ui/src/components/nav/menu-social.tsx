import { List, MessagesSquare, MoreHorizontal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { getRankedThreads } from "@/lib/social";

import { Menu } from "@/components/nav/menu";

const TOP = 5;

export const SocialMenu = () => {
    const fractal = useFractalAccount();
    const { thread: currentParam } = useParams();
    const current = currentParam === "~all" ? undefined : currentParam;
    const ranked = useQuery({
        queryKey: ["social-ranked", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getRankedThreads(fractal!),
    });
    const rankedRows = ranked.data ?? [];
    const top = rankedRows.slice(0, TOP);
    const shown =
        current && !top.some((thread) => thread.account === current)
            ? [
                  rankedRows.find((thread) => thread.account === current) ?? {
                      account: current,
                      title: current,
                      fee: "0",
                  },
                  ...top,
              ]
            : top;

    return (
        <Menu.Item title="Social" Icon={MessagesSquare} path="/threads">
            <Menu.SubItem title="All" path="/threads/~all" Icon={List} />
            {shown.map((thread) => (
                <Menu.SubItem
                    key={thread.account}
                    title={thread.title}
                    path={`/threads/${thread.account}`}
                    Icon={MessagesSquare}
                    end={false}
                />
            ))}
            <Menu.SubItem title="More..." path="/threads" Icon={MoreHorizontal} />
        </Menu.Item>
    );
};
