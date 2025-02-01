import { useEffect, useState } from "react";
import { FunctionCallArgs, Supervisor, siblingUrl } from "@psibase/common-lib";

const buttonStyle = {
  backgroundColor: "#000",
  color: "#ddd",
  border: "none",
  cursor: "pointer",
  borderRadius: "5px",
  padding: "0.5rem 1rem",
};

function withArgs(
  service: string,
  plugin: string,
  intf: string,
  method: string,
  params: unknown[] = []
): FunctionCallArgs {
  return {
    service,
    plugin,
    intf,
    method,
    params,
  };
}

export function LoginBar({ supervisor }: { supervisor: Supervisor }) {
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await supervisor.functionCall(
          withArgs("accounts", "plugin", "api", "getCurrentUser")
        );
        setCurrentUser(user || null);
      } catch (e) {
        console.error("Error fetching current user:", e);
        alert("Error fetching current user: " + e);
      }
    };

    fetchUser();
  }, [supervisor]);

  const handleClick = async () => {
    try {
      if (currentUser) {
        await supervisor.functionCall(
          withArgs("accounts", "plugin", "activeApp", "logout")
        );
        setCurrentUser(null);
      } else {
        const token = await supervisor.functionCall(
          withArgs("accounts", "plugin", "activeApp", "createConnectionToken")
        );

        window.location.href = siblingUrl(
          null,
          "accounts",
          `/?token=${encodeURIComponent(token)}`
        );
      }
    } catch (e) {
      console.error("Error logging out or in: ", e);
      alert("Error logging out or in: " + e);
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "right" }}>
      <button onClick={handleClick} style={buttonStyle}>
        {currentUser ? currentUser : "Connect account"}
      </button>
    </div>
  );
}
