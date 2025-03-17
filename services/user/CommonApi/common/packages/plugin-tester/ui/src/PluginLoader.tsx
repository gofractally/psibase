import type { Supervisor } from "@psibase/common-lib";
import type { SchemaFunction } from "./types";

import { useState, useEffect } from "react";
import { ServiceInput } from "./components/ServiceInput";
import { ExecutionTabs } from "./components/ExecutionTabs";
import { FunctionSelector } from "./components/FunctionSelector";
import { ParametersSection } from "./components/ParametersSection";
import { usePluginSchema } from "./hooks/usePluginSchema";
import { getTypeInfo, camelCase } from "./utils";

export function PluginLoader({ supervisor }: { supervisor: Supervisor }) {
  const [service, setService] = useState("");
  const [plugin, setPlugin] = useState("plugin");
  const { schema, loadSchema, clearSchema } = usePluginSchema(supervisor);
  const [selectedFunction, setSelectedFunction] =
    useState<SchemaFunction | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const fetchCurrentService = async () => {
      try {
        const response = await fetch("/common/thisservice");
        const currentService = JSON.parse(await response.text());
        if (currentService) {
          setService(currentService);
          loadSchema(currentService, plugin);
        }
      } catch (e) {
        console.error("Error fetching current service:", e);
      }
    };
    fetchCurrentService();
  }, [plugin, loadSchema]);

  // Initialize parameter values when selected function changes
  useEffect(() => {
    if (selectedFunction && schema) {
      const initialValues = selectedFunction.params.reduce(
        (acc, param) => ({
          ...acc,
          [camelCase(param.name)]: getTypeInfo(param.type, schema).defaultValue,
        }),
        {}
      );
      setParamValues(initialValues);
    }
  }, [selectedFunction, schema]);

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
        onLoad={() => {
          clearSchema();
          setSelectedFunction(null);
          setParamValues({});
          loadSchema(service, plugin);
        }}
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
            <>
              <ParametersSection
                selectedFunction={selectedFunction}
                schema={schema}
                values={paramValues}
                onParamValuesChange={setParamValues}
              />
              <ExecutionTabs
                selectedFunction={selectedFunction}
                service={service}
                plugin={plugin}
                supervisor={supervisor}
                selectedInterfaceName={selectedFunction.interfaceName}
                paramValues={paramValues}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
