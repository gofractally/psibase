export function MainPage() {
    return (
        <div style={{ padding: "20px", fontFamily: "monospace" }}>
            <div style={{ marginBottom: "20px" }}>
                <p
                    style={{
                        fontSize: "16px",
                        lineHeight: "1.5",
                        color: "#333",
                    }}
                >
                    This app (supervisor) is intended to be embedded into an app
                    and interacted with via window.postMessage()
                </p>
            </div>
        </div>
    );
}
