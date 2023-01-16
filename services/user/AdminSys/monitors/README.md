# Monitors

Psinode monitoring is powered by metrics collected and fed into Prometheus. Then, Grafana is used to manage dashboards and visualize all the collected data.

## Running with docker

1. Before running you need to add a logger file to the psibase node config you want to inspect. See the suggested config below. You can simply add that inside the admin sys config or just edit the config file of the node database.

```ini
[logger.~00017668]
type = file
filter = Severity >= info
format = [{TimeStamp}] [{Severity}]{?: [{RemoteEndpoint}]}: {Message}{?: {BlockId}}{?RequestMethod:: {RequestMethod} {RequestHost}{RequestTarget}{?: {ResponseStatus}{?: {ResponseBytes}}}}{?: {ResponseTime} µs}
# The log file pattern
filename = /home/sohdev/Workspace/eden/psibase/build/tester_psinode_db/psibase.log
# The pattern for rotated log files
target = /home/sohdev/Workspace/eden/psibase/build/tester_psinode_db/psibase-%Y%m%d-%N.log
# Rotate logs when they reach this size
rotationSize = 10000000
# Time when logs are rotated
rotationTime = 00:00:00Z
# Maximum number of log files retained
maxFiles = 1002
# Maximum total size of log files retained
maxSize = 1073741823
# Whether to flush every log record
flush = on
```

2. Update the `prometheus.yml` file to have the correct target of your psinode instance. Eg: if it's running locally, outside of your docker network, you can leave as is and add a new built-in config in the psinode admin panel:

```
service = host.docker.internal:/home/sohdev/Workspace/eden/psibase/build/share/psibase/services/admin-sys
```

If the psinode is running in another docker, just make sure you have access to that network and update the target properly. You will not need the builtin service conf.

3. With that config successfully added, you need to edit `docker-compose.yml` and update the `psinode_db` volume path to be pointing to the correct psinode db of your psibase node. This is how we read the logs to calculate the http stats.

Then simply run:

```sh
docker-compose up
```

Open `http://localhost:8080` and you will be able to see the Admin-Sys panel with the embedded dashboards.

## Running locally

You don't need to, but if you prefer or have to run this in the same server, you can execute the following steps.

Grok exporter listens to psibase logs and extracts the metrics.

```sh
wget https://github.com/fstab/grok_exporter/releases/download/v1.0.0.RC5/grok_exporter-1.0.0.RC5.linux-amd64.zip
unzip grok_exporter-*.zip
cd grok_exporter-*
./grok_exporter --config=./grok-exporter.yml
```

Json exporter is used to transform the `/native/admin/perf` endpoint to ready to be consumed metrics.

```sh
wget https://github.com/prometheus-community/json_exporter/releases/download/v0.5.0/json_exporter-0.5.0.linux-amd64.tar.gz
tar -xzvf json_exporter-0.5.0.linux-amd64.tar.gz
cd json_exporter-*
./json_exporter --config.file ../../prometheus/json-exporter.yml
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

## Setup grafana:

Grafana

```sh
wget https://dl.grafana.com/enterprise/release/grafana-enterprise-9.3.2.linux-amd64.tar.gz
tar -zxvf grafana-enterprise-9.3.2.linux-amd64.tar.gz
```

Manually edit the defaults.ini config file:

```ini
allow_embedding=true

#################################### Anonymous Auth ######################
[auth.anonymous]
# enable anonymous access
enabled = true

# specify role for unauthenticated users
org_role = Admin
```

Then run `./graphana-server`. Add prometheus as a data source and use the `./dashboards/psinode-dashboard.json` to import it.
