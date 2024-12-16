import { useEffect, useState } from "react";
import { Supervisor } from "@psibase/common-lib";

interface SchemaParam {
  name: string;
  type: unknown;
}

interface SchemaFunction {
  name: string;
  params: SchemaParam[];
}

interface SchemaInterface {
  name?: string;
  functions?: Record<string, SchemaFunction>;
}

interface ExportedInterface {
  interface: {
    id: number;
  };
}

interface World {
  name: string;
  exports?: Record<string, ExportedInterface>;
}

interface Schema {
  worlds: World[];
  interfaces: SchemaInterface[];
}

interface ExportedMethodsByInterface {
  [interfaceName: string]: SchemaFunction[];
}

function camelCase(str: string): string {
  return str
    .split(/[-_ ]+/)
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}

const commonButtonStyle = {
  padding: "0.5rem 1rem",
  backgroundColor: "#000",
  color: "#ddd",
  border: "none",
  cursor: "pointer",
  borderRadius: "5px",
};

const commonTextAreaStyle = {
  width: "100%",
  height: "150px",
  backgroundColor: "#1f1f1f",
  color: "#ddd",
  border: "1px solid #555",
  fontFamily: "monospace",
};

const tabStyle = (isSelected: boolean) => ({
  cursor: "pointer",
  padding: "0.5rem 1rem",
  backgroundColor: isSelected ? "#444" : "transparent",
  borderTopLeftRadius: "5px",
  borderTopRightRadius: "5px",
});

export function PluginLoader({ supervisor }: { supervisor: Supervisor }) {
  const [service, setService] = useState("invite");
  const [plugin, setPlugin] = useState("plugin");
  const [schemaText, setSchemaText] = useState("");
  const [schema, setSchema] = useState<Schema | null>(null);
  const [selectedInterfaceName, setSelectedInterfaceName] = useState<
    string | null
  >(null);
  const [selectedFunction, setSelectedFunction] =
    useState<SchemaFunction | null>(null);
  const [paramValues, setParamValues] = useState("");
  const [responseText, setResponseText] = useState("No response yet");
  const [executionTab, setExecutionTab] = useState<"Execution" | "Embed">(
    "Execution"
  );

  const reset = () => {
    setSelectedFunction(null);
    resetSelected();
  };

  const resetSelected = () => {
    setParamValues("");
    setResponseText("No response yet");
    setExecutionTab("Execution");
  };

  const handleRetrieve = async () => {
    setSchemaText(await supervisor.getJson({ service, plugin }));
  };

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

  useEffect(() => {
    if (schemaText) {
      try {
        const parsed = JSON.parse(schemaText) as Schema;
        setSchema(parsed);
        reset();
      } catch {
        alert("Invalid plugin JSON");
      }
    }
  }, [schemaText, reset]);

  const getExportedInterfaceIds = (): number[] => {
    if (!schema) return [];
    const rootWorld = schema.worlds.find((w) => w.name === "root");
    return rootWorld?.exports
      ? Object.values(rootWorld.exports).map((exp) => exp.interface.id)
      : [];
  };

  const getExportedMethodsByInterface = (): ExportedMethodsByInterface => {
    if (!schema) return {};
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
  };

  const exportedMethods = getExportedMethodsByInterface();

  useEffect(() => {
    if (!selectedInterfaceName && Object.keys(exportedMethods).length > 0) {
      setSelectedInterfaceName(Object.keys(exportedMethods)[0]);
    }
  }, [exportedMethods, selectedInterfaceName]);

  const handleSelectFunction = (fn: SchemaFunction) => {
    setSelectedFunction(fn);
    const initialParams = Object.fromEntries(
      fn.params.map((p) => [p.name, ""])
    );
    setParamValues(JSON.stringify(initialParams, null, 2));
    resetSelected();
  };

  const handleExecute = async () => {
    if (!selectedFunction || !selectedInterfaceName) return;
    try {
      const response = await supervisor.functionCall({
        service,
        plugin,
        intf: camelCase(selectedInterfaceName),
        method: camelCase(selectedFunction.name),
        params: parseParams(),
      });
      setResponseText(JSON.stringify(response, null, 2));
    } catch (e) {
      console.error(e);
      setResponseText("Error: Check console for more details.");
    }
  };

  const generateEmbedCode = (): string => {
    if (!selectedFunction || !selectedInterfaceName) return "";

    return `const response = await supervisor.functionCall({
  service: "${service}", 
  plugin: "${plugin}", 
  intf: "${camelCase(selectedInterfaceName)}", 
  method: "${camelCase(selectedFunction.name)}", 
  params: ${JSON.stringify(parseParams(), null, 2)}
});`;
  };

  return (
    <div
      style={{
        padding: "1rem",
        backgroundColor: "#2f2f2f",
        color: "#ddd",
        fontFamily: "sans-serif",
      }}
    >
      <h2 style={{ marginTop: "0", textAlign: "left" }}>Plugin Tester</h2>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <input
          style={{ padding: "0.5rem" }}
          placeholder="Service name"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <input
          style={{ padding: "0.5rem" }}
          placeholder="Plugin name"
          value={plugin}
          onChange={(e) => setPlugin(e.target.value)}
        />
        <button onClick={handleRetrieve} style={commonButtonStyle}>
          Load
        </button>
      </div>

      {schema && (
        <div>
          <div
            style={{
              display: "flex",
              marginBottom: "1rem",
              borderBottom: "1px solid #555",
            }}
          >
            {Object.keys(exportedMethods).map((intfName) => (
              <div
                key={intfName}
                onClick={() => {
                  setSelectedInterfaceName(intfName);
                  reset();
                }}
                style={tabStyle(selectedInterfaceName === intfName)}
              >
                {intfName.charAt(0).toUpperCase() + intfName.slice(1)}
              </div>
            ))}
          </div>

          {selectedInterfaceName && (
            <div>
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
                    style={{
                      ...commonButtonStyle,
                      backgroundColor:
                        selectedFunction?.name === fn.name ? "#666" : "#444",
                    }}
                    onClick={() => handleSelectFunction(fn)}
                  >
                    {fn.name}
                  </button>
                ))}
              </div>

              {selectedFunction && (
                <>
                  {selectedFunction.params.length > 0 && (
                    <>
                      <h3 style={{ marginBottom: "0.5rem" }}>Parameters</h3>
                      <textarea
                        style={{ ...commonTextAreaStyle, marginBottom: "1rem" }}
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
                        onClick={() =>
                          setExecutionTab(tab as "Execution" | "Embed")
                        }
                        style={tabStyle(executionTab === tab)}
                      >
                        {tab}
                      </div>
                    ))}
                  </div>

                  {executionTab === "Execution" ? (
                    <>
                      <div style={{ marginBottom: "1rem", textAlign: "left" }}>
                        <button
                          onClick={handleExecute}
                          style={commonButtonStyle}
                        >
                          Execute
                        </button>
                      </div>
                      <h3 style={{ marginBottom: "0.5rem" }}>Response</h3>
                      <textarea
                        style={commonTextAreaStyle}
                        readOnly
                        value={responseText}
                      />
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
                        To call this plugin function from your own application,
                        use:
                      </p>
                      <textarea
                        style={{ ...commonTextAreaStyle, height: "200px" }}
                        readOnly
                        value={generateEmbedCode()}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
