import type { Supervisor } from "@psibase/common-lib";
import type { SchemaFunction } from "../types";

import { useState } from "react";

import { camelCase, withArgs } from "../utils";
import { TabControl } from "./TabControl";

interface ExecutionTabsProps {
  selectedFunction: SchemaFunction;
  service: string;
  plugin: string;
  selectedInterfaceName: string;
  supervisor: Supervisor;
  paramValues: Record<string, unknown>;
}

export function ExecutionTabs({
  selectedFunction,
  service,
  plugin,
  selectedInterfaceName,
  supervisor,
  paramValues,
}: ExecutionTabsProps) {
  const [responseText, setResponseText] = useState("No response yet");
  const [executionTab, setExecutionTab] = useState<"Execution" | "Embed">(
    "Execution"
  );

  const getCleanValues = () => {
    return Object.fromEntries(
      Object.entries(paramValues).filter(([key]) => !key.endsWith("RawInput"))
    );
  };

  const parseParams = (): unknown[] => {
    const cleanValues = getCleanValues();
    return Array.isArray(cleanValues)
      ? cleanValues
      : Object.values(cleanValues);
  };

  const handleExecute = async () => {
    try {
      const response = await supervisor.functionCall(
        withArgs(
          service,
          plugin,
          camelCase(selectedInterfaceName),
          camelCase(selectedFunction.name),
          parseParams()
        )
      );
      setResponseText(
        response === undefined
          ? "Execution successful"
          : JSON.stringify(
              response,
              (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
              2
            )
      );
    } catch (e) {
      console.error(e);
      setResponseText("Error: Check console for more details.");
    }
  };

  const generateEmbedCode = (): string => {
    const cleanValues = getCleanValues();
    return `const response = await supervisor.functionCall({
  service: "${service}",
  plugin: "${plugin}",
  intf: "${camelCase(selectedInterfaceName)}",
  method: "${camelCase(selectedFunction.name)}",
  params: ${JSON.stringify(cleanValues, null, 2)}
});`;
  };

  return (
    <>
      <TabControl
        selectedTab={executionTab}
        onTabChange={(tab) => setExecutionTab(tab as "Execution" | "Embed")}
        tabs={["Execution", "Embed"]}
      />

      {executionTab === "Execution" ? (
        <>
          <div className="execution-container">
            <button onClick={handleExecute} className="common-button">
              Execute
            </button>
          </div>
          <h3 className="response-title">Response</h3>
          <textarea className="common-textarea" readOnly value={responseText} />
        </>
      ) : (
        <div className="embed-container">
          <p className="embed-description">
            To call this plugin function from your own application, use:
          </p>
          <textarea
            className="common-textarea embed-textarea"
            readOnly
            value={generateEmbedCode()}
          />
        </div>
      )}
    </>
  );
}
