# x-admin

The adminstrator service is hosted on localhost by default as a [Builtin Service](#builtin-services). It provides tools for monitoring and controlling the server.

## Configuration Options

All of these options can also be specified on the command line or in the server's config file. Changes applied through the web API will be saved to the config file and will be remembered across server restarts. Except where noted otherwise, a new configuration takes effect when saved.

### Accept incoming P2P connections

If enabled, the node will accept p2p connections at the websocket endpoint `/native/p2p`.

### Block Producer Name

The name that the server uses to produce blocks. It must be a valid [account name](../development/services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber). The node will only produce blocks when its producer name is one of the currently active producers specified by the chain. To disable block production, the producer name can be left blank.

### Host

The root host name for services. If it is empty, only builtin services will be available.

### Port

The TCP port on which the server listens. The server must be restarted for a change to the port to take effect.

### Logger

See [Logging](../run-infrastructure/configuration/logging.md) for a list of the available logger types and their parameters.

### Builtin Services

`psinode` will serve content directly from the filesystem when the request's host matches the host of a builtin service. A builtin service hides a chain service with the same name.

Builtin services have significant limitations. On-chain services should be preferred unless the service requires access to the admin API (the administrator service) or needs to be available before the chain is booted.

Builtin services can only serve the following files types:

- `.html`
- `.svg`
- `.js`
- `.mjs`
- `.css`
- `.ttf`
- `.wasm`

### Access to admin API

This option controls access to the [HTTP API](../run-infrastructure/administration.md#node-administrator-services) under `/native/admin`, which is used by the administrator service. The admin API must be restricted to services trusted by the node operator, because it can tell `psinode` to read or write any file.

- Builtin services only: Allows builtin services to access the admin API. This is the default and should rarely need to be changed.
- All services: Allows any service to access the admin API. This should only be used for trusted private chains.
- Disabled: The admin API will not be available. Configuration changes can only be made via the command line and config file, which require a server restart. Disabling the admin API will disconnect the administrator service.

## HTTP Endpoints

| Method   | URL               | Description                                                                                                                                                      |
|----------|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `GET`    | `/services/*`     | Returns the wasm for a subjective service                                                                                                                        |
| `PUT`    | `/services/*`     | Sets the wasm for a subjective service                                                                                                                           |
| `GET`    | `/admin_accounts` | Returns a JSON list of all on-chain accounts that are authorized to administer the node                                                                          |
| `POST`   | `/admin_accounts` | Takes a JSON object of the form `{"account": String, "admin": bool}` and either adds or removes the account from the set of administrator accounts for the node. |
| `GET`    | `/admin_login`    | Returns a token to authenticate as `x-admin` to other services.                                                                                                  |
| `GET`    | `*`               | Returns static content                                                                                                                                           |
| `PUT`    | `*`               | Uploads static content                                                                                                                                           |
| `DELETE` | `*`               | Removes static content                                                                                                                                           |

## Service

{{#cpp-doc ::LocalService::XAdmin}}

## Monitoring Dashboards

Psinode monitoring is powered by metrics collected and fed into Prometheus. Then, Grafana is used to manage dashboards and visualize all the collected data.

The easiest way to run these services is to use docker containers, since we prepared a docker-compose file with all the needed services.

**All the following instructions are assuming you are working with the files under the Psibase repo, in the `/packages/local/XAdmin/monitors` directory.**

### Running with docker

Update the `prometheus.yml` file to have the correct target of your psinode instance. Eg: if it's running locally, outside of your docker network, you can leave as is and add a new built-in service in psinode config, then restart it:

```
service = host.docker.internal:
```

If the psinode is running in another docker, just make sure you have access to that network and update the target properly. You will not need the builtin service conf.

Then, simply run:

```sh
docker-compose up
```

Open `http://localhost:8080` and you will be able to see the XAdmin panel with the embedded dashboards.

### Proxying Grafana

If you are accessing the x-admin ui locally, eg. from http://localhost:8080 you can skip this part.

Most cases you will end up putting the access to the x-admin behind a reverse proxy with at least the minimum HTTP basic-auth or perhaps restricting IPs. In any case, this reverse proxy needs to add a rule for accessing the Grafana dashboards on `/grafana` location. Here's an example:

```conf
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

upstream docker-grafana {
    server grafana:3000;
}

server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html index.htm;

    location /grafana/ {
        rewrite  ^/grafana/(.*)  /$1 break;
        proxy_set_header Host $http_host;
        proxy_pass http://docker-grafana;
    }

    # Proxy Grafana Live WebSocket connections.
    location /grafana/api/live/ {
        rewrite  ^/grafana/(.*)  /$1 break;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $http_host;
        proxy_pass http://docker-grafana;
    }
}
```

Full instructions can be found here: https://grafana.com/tutorials/run-grafana-behind-a-proxy/

### Running locally

You don't need to, but if you prefer or have to run these services in your dedicated server, you can execute the following steps.

Grok exporter listens to psibase logs and extracts the metrics.

```sh
wget https://github.com/fstab/grok_exporter/releases/download/v1.0.0.RC5/grok_exporter-1.0.0.RC5.linux-amd64.zip
unzip grok_exporter-*.zip
cd grok_exporter-*
./grok_exporter --config=./grok-exporter.yml
```

Node exporter collects metrics from the node (not being used in our dashboard for now).

```sh
wget https://github.com/prometheus/node_exporter/releases/download/v1.5.0/node_exporter-1.5.0.linux-amd64.tar.gz
tar -xzvf node_exporter-*.*.tar.gz
```

Prometheus is the timeseries DB that will consolidate all the above metrics.

```sh
wget https://github.com/prometheus/prometheus/releases/download/v2.41.0/prometheus-2.41.0.linux-amd64.tar.gz
tar xvfz prometheus-*.tar.gz
cd prometheus-*
./prometheus --config.file=../prometheus.yml
```
