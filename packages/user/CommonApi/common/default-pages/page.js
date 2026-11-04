// Served on any account subdomain without a page, so the account and network are taken from the URL.
const [account, ...rootLabels] = location.hostname.split(".");
const rootHost = rootLabels.join(".");
const port = location.port ? `:${location.port}` : "";

const siblingUrl = (subdomain, path = "/") =>
    `${location.protocol}//${subdomain}.${rootHost}${port}${path}`;

const links = {
    homepage: siblingUrl("homepage"),
    workshop: siblingUrl("workshop"),
    docs: siblingUrl("docs", "/development/"),
};

const graphql = async (service, query) => {
    const res = await fetch(siblingUrl(service, "/graphql"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`${service} query failed: ${res.status}`);
    const { data, errors } = await res.json();
    if (errors) throw new Error(errors[0].message);
    return data;
};

const forEachMatch = (selector, apply) =>
    document.querySelectorAll(selector).forEach(apply);

document.title = `${account} · ${document.title}`;
forEachMatch("[data-account]", (el) => (el.textContent = account));
forEachMatch("[data-link]", (el) => (el.href = links[el.dataset.link]));

graphql("branding", "{ networkName }")
    .then(({ networkName }) => {
        if (!networkName) return;
        forEachMatch("[data-network]", (el) => {
            el.textContent = networkName;
            el.hidden = false;
        });
    })
    .catch(console.warn);

graphql(
    "packages",
    '{ installed(ge: {name: "Workshop", owner: ""}, first: 1) { edges { node { name } } } }',
)
    .then(({ installed }) => {
        if (installed.edges[0]?.node.name === "Workshop")
            forEachMatch("[data-workshop]", (el) => (el.hidden = false));
    })
    .catch(console.warn);
