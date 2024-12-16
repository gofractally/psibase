import { SchemaFunction } from "../types";
import { camelCase, withArgs } from "../utils";
import { Supervisor } from "@psibase/common-lib";
import { useState, useEffect } from "react";

export function ExecutionTabs({
  selectedFunction,
  service,
  plugin,
  selectedInterfaceName,
  supervisor,
}: {
  selectedFunction: SchemaFunction;
  service: string;
  plugin: string;
  selectedInterfaceName: string;
  supervisor: Supervisor;
}) {
  const [paramValues, setParamValues] = useState("");
  const [responseText, setResponseText] = useState("No response yet");
  const [executionTab, setExecutionTab] = useState<"Execution" | "Embed">(
    "Execution"
  );

  useEffect(() => {
    const initialParams = Object.fromEntries(
      selectedFunction.params.map((p) => [p.name, ""])
    );
    setParamValues(JSON.stringify(initialParams, null, 2));
    setResponseText("No response yet");
    setExecutionTab("Execution");
  }, [selectedFunction]);

  const parseParams = (): unknown[] => {
    try {
      const parsedParams = paramValues ? JSON.parse(paramValues) : {};
      return Array.isArray(parsedParams)
        ? parsedParams
        : Object.values(parsedParams);
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
          : JSON.stringify(response, null, 2)
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
      {selectedFunction.params.length > 0 && (
        <>
          <h3 style={{ marginBottom: "0.5rem" }}>Parameters</h3>
          <textarea
            className="common-textarea"
            style={{ marginBottom: "1rem" }}
            value={paramValues}
            onChange={(e) => setParamValues(e.target.value)}
          />
        </>
      )}

      <div
        style={{
          display: "flex",
          marginBottom: "1rem",
          borderBottom: "1px solid #555",
        }}
      >
        {["Execution", "Embed"].map((tab) => (
          <div
            key={tab}
            onClick={() => setExecutionTab(tab as "Execution" | "Embed")}
            className={`tab ${executionTab === tab ? "selected" : ""}`}
          >
            {tab}
          </div>
        ))}
      </div>

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
            value={generateEmbedCode()}
          />
        </div>
      )}
    </>
  );
}
