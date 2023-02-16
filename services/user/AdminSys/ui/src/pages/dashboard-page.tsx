const DASHBOARDS_PREFIX =
    window.location.hostname === "localhost"
        ? "http://localhost:8091/grafana"
        : "/grafana";

export const DashboardPage = () => {
    return (
        <iframe
            src={`${DASHBOARDS_PREFIX}/d/psinode-dashboard?orgId=1&from=now-1h&to=now&refresh=5s&theme=light&kiosk=tv`}
            style={{ overflow: "hidden", height: "100%", width: "100%" }}
            height="100%"
            width="100%"
        />
    );
};
