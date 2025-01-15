import { SchemaFunction } from "../types";
import { camelCase, withArgs } from "../utils";
import { Supervisor } from "@psibase/common-lib";
import { useState } from "react";
import { TabControl } from "./TabControl";

interface ExecutionTabsProps {
  selectedFunction: SchemaFunction;
  service: string;
  plugin: string;
  selectedInterfaceName: string;
  supervisor: Supervisor;
  paramValues: string;
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

  const parseParams = (): unknown[] => {
    try {
      const parsed = JSON.parse(paramValues);
      return Array.isArray(parsed) ? parsed : Object.values(parsed);
    } catch {
      return [];
    }
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
    return `const response = await supervisor.functionCall({
  service: "${service}",
  plugin: "${plugin}",
  intf: "${camelCase(selectedInterfaceName)}",
  method: "${camelCase(selectedFunction.name)}",
  params: ${JSON.stringify(JSON.parse(paramValues), null, 2)}
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
          <div style={{ marginBottom: "1rem", textAlign: "left" }}>
            <button onClick={handleExecute} className="common-button">
              Execute
            </button>
          </div>
          <h3 style={{ marginBottom: "0.5rem" }}>Response</h3>
          <textarea className="common-textarea" readOnly value={responseText} />
        </>
      ) : (
        <div
          style={{
            marginTop: "1rem",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            textAlign: "left",
          }}
        >
          <p style={{ marginBottom: "0.5rem" }}>
            To call this plugin function from your own application, use:
          </p>
          <textarea
            className="common-textarea"
            style={{ height: "200px" }}
            readOnly
            value={(() => {
              try {
                return generateEmbedCode();
              } catch (e) {
                return "Parameters configuration produces invalid JSON";
              }
            })()}
          />
        </div>
      )}
    </>
  );
}
