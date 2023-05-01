function isLocalhost() {
    const hostname = window.location.hostname;
    const localhostPatterns = [
        /^(.*\.)?localhost.*$/,
        /^(.*\.)?127\.0\.0\.1(\..*)?$/,
        /^(.*\.)?127\.0\.0\.1:(.*)?$/,
        /^\[::1\].*$/,
        /^(.*\.)?--1(\..*)?/ // ipv6 sslip.io
    ];

    return localhostPatterns.some(pattern => pattern.test(hostname));
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
