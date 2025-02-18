import { FileUploader } from "@/components/file-uploader";
import { ChevronRight, File, Folder } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { useSiteConfig } from "@/hooks/useSiteConfig";
import { useCurrentApp } from "@/hooks/useCurrentApp";

// @ts-ignore
function Tree({ item }: { item: string | any[] }) {
  const [name, ...items] = Array.isArray(item) ? item : [item];

  if (!items.length) {
    return (
      <SidebarMenuButton
        isActive={name === "button.tsx"}
        className="data-[active=true]:bg-transparent"
      >
        <File />
        {name}
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuItem>
      <Collapsible
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
        defaultOpen={name === "components" || name === "ui"}
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight className="transition-transform" />
            <Folder />
            {name}
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((subItem, index) => (
              <Tree key={index} item={subItem} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

type Node = string | [string, ...Node[]];

type FlatNode = {
  node: {
    path: string;
  };
};

// @ts-ignore
const convertToNestedArray = (obj: Record<string, any>, name: string): Node => {
  const children = Object.entries(obj).map(([key, value]) =>
    convertToNestedArray(value, key)
  );
  return children.length ? [name, ...children] : name;
};

const buildTree = (flatData: FlatNode[]): Node[] => {
  // @ts-ignore
  const root: Record<string, any> = {};

  for (const { node } of flatData) {
    const parts = node.path.split("/").filter(Boolean);
    let current = root;

    for (const part of parts) {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
  }

  return Object.entries(root).map(([key, value]) =>
    convertToNestedArray(value, key)
  );
};

export const Upload = () => {
  const currentApp = useCurrentApp();
  const { data } = useSiteConfig(currentApp);

  const tree = data ? buildTree(data?.getContent.edges) : [];

  return (
    <div className="mx-auto w-full grid p-4 grid-cols-1  gap-8 max-w-screen-xl list-none">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Upload Files</h1>
        <FileUploader />
      </div>
      <div>
        {tree.map((subItem, index) => (
          <Tree key={index} item={subItem} />
        ))}
      </div>
    </div>
  );
};
