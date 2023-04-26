function isLocalhost() {
    const hostname = window.location.hostname;
    return hostname.includes('localhost') || hostname.includes('127.0.0.1');
}

const GRAFANA_PORT = 3000;
const DASHBOARDS_PREFIX = isLocalhost()
        ? `http://${window.location.hostname}:${GRAFANA_PORT}/grafana`
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
