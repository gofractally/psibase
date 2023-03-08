import { MainLayout } from "components/layouts/main-layout";
import { NavLinkItemProps } from "components/navigation/nav-link-item";
import { Sidebar } from "components/sidebar";
import { useFractal } from "hooks/useParticipatingFractals";
import { useParams } from "react-router-dom";

export const FractalSidebar = ({
  menuItems,
}: {
  menuItems: NavLinkItemProps[];
}) => {
  const { fractalID } = useParams();
  const { data } = useFractal(fractalID);

  return (
    <MainLayout>
      <Sidebar menuItems={menuItems} title={data?.name || ""} />
    </MainLayout>
  );
};
