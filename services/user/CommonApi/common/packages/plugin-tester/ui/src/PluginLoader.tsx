import { useState } from "react";
import { Supervisor } from "@psibase/common-lib";
import { ServiceInput } from "./components/ServiceInput";
import { ExecutionTabs } from "./components/ExecutionTabs";
import { SchemaFunction } from "./types";
import { usePluginSchema } from "./hooks/usePluginSchema";
import { FunctionSelector } from "./components/FunctionSelector";

export function PluginLoader({ supervisor }: { supervisor: Supervisor }) {
  const [service, setService] = useState("");
  const [plugin, setPlugin] = useState("plugin");
  const { schema, loadSchema } = usePluginSchema(supervisor);
  const [selectedFunction, setSelectedFunction] =
    useState<SchemaFunction | null>(null);

  const downloadSchema = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(schema, null, 2));
    const downloadAnchorNode = document.createElement("a");
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "schema.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="plugin-container">
      <ServiceInput
        service={service}
        plugin={plugin}
        onServiceChange={setService}
        onPluginChange={setPlugin}
        onLoad={() => loadSchema(service, plugin)}
      />

      {schema && (
        <>
          <button onClick={downloadSchema} className="common-button">
            Download JSON
          </button>
          <FunctionSelector
            schema={schema}
            onFunctionSelect={setSelectedFunction}
          />
          {selectedFunction && selectedFunction.interfaceName && (
            <ExecutionTabs
              selectedFunction={selectedFunction}
              service={service}
              plugin={plugin}
              supervisor={supervisor}
              selectedInterfaceName={selectedFunction.interfaceName}
              schema={schema}
            />
          )}
        </>
      )}
    </div>
  );
}
