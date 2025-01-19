import { useMemo, useState, useCallback } from "react";
import { Schema, SchemaFunction, ExportedMethodsByInterface } from "../types";
import { TabControl } from "./TabControl";

interface FunctionSelectorProps {
  schema: Schema;
  onFunctionSelect: (fn: SchemaFunction | null) => void;
}

export function FunctionSelector({
  schema,
  onFunctionSelect,
}: FunctionSelectorProps) {
  const [selectedInterfaceName, setSelectedInterfaceName] = useState<
    string | null
  >(null);
  const [selectedFunction, setSelectedFunction] =
    useState<SchemaFunction | null>(null);

  const getExportedInterfaceIds = useCallback(() => {
    const rootWorld = schema.worlds.find((w) => w.name === "root");
    return rootWorld?.exports
      ? Object.values(rootWorld.exports).map((exp) => exp.interface.id)
      : [];
  }, [schema]);

  const getExportedMethodsByInterface =
    useCallback((): ExportedMethodsByInterface => {
      const exportedInterfaceIds = getExportedInterfaceIds();
      const result: ExportedMethodsByInterface = {};

      exportedInterfaceIds.forEach((id) => {
        const intf = schema.interfaces[id];
        if (intf?.functions && intf.name) {
          const fns = Object.values(intf.functions);
          if (fns.length > 0) {
            result[intf.name] = fns;
          }
        }
      });
      return result;
    }, [getExportedInterfaceIds]);

  const exportedMethods = useMemo(getExportedMethodsByInterface, [
    getExportedMethodsByInterface,
  ]);

  const handleInterfaceSelect = (name: string) => {
    setSelectedInterfaceName(name);
    setSelectedFunction(null);
    onFunctionSelect(null);
  };

  const handleFunctionSelect = (fn: SchemaFunction) => {
    setSelectedFunction({
      ...fn,
      interfaceName: selectedInterfaceName!,
    });
    onFunctionSelect({
      ...fn,
      interfaceName: selectedInterfaceName!,
    });
  };

  return (
    <div>
      <h3 style={{ marginBottom: "0.5rem" }}>Functions</h3>
      <TabControl
        selectedTab={selectedInterfaceName || ""}
        onTabChange={handleInterfaceSelect}
        tabs={Object.keys(exportedMethods)}
      />
      {selectedInterfaceName && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          {exportedMethods[selectedInterfaceName]?.map((fn, i) => (
            <button
              key={i}
              className={`function-button ${
                fn.name === selectedFunction?.name &&
                selectedInterfaceName === selectedFunction?.interfaceName
                  ? "selected"
                  : ""
              }`}
              onClick={() => handleFunctionSelect(fn)}
            >
              {fn.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
