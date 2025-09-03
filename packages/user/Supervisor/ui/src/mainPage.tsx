import { useState } from "react";

import { LocalStorageManager } from "./localStorageManager";

export function MainPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

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

            <button
                onClick={openModal}
                style={{
                    padding: "12px 24px",
                    background: "#007bff",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "16px",
                    fontWeight: "500",
                }}
            >
                LocalStorage Manager
            </button>

            {isModalOpen && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(0, 0, 0, 0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000,
                    }}
                    onClick={closeModal}
                >
                    <div
                        style={{
                            background: "white",
                            borderRadius: "8px",
                            maxWidth: "90vw",
                            maxHeight: "90vh",
                            overflow: "auto",
                            position: "relative",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{
                                position: "sticky",
                                top: 0,
                                background: "white",
                                padding: "16px 20px",
                                borderBottom: "1px solid #ddd",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <h2 style={{ margin: 0 }}>LocalStorage Manager</h2>
                            <button
                                onClick={closeModal}
                                style={{
                                    background: "none",
                                    border: "none",
                                    fontSize: "24px",
                                    cursor: "pointer",
                                    color: "#666",
                                }}
                            >
                                ×
                            </button>
                        </div>
                        <LocalStorageManager />
                    </div>
                </div>
            )}
        </div>
    );
}
