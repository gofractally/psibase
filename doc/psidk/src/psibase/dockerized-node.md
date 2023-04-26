# Introduction

There are several ways to get [psinode](../README.md) running in almost any environment. It's always possible to set up an Ubuntu (>= 20.04) server according to the environment defined in [this Dockerfile](https://github.com/gofractally/psibase/blob/main/docker/ubuntu-2004-builder.Dockerfile) and then either build from source, or install the prebuilt binaries from our latest deployment of the [Rolling Release](https://github.com/gofractally/psibase/releases/tag/rolling-release).

But the quickest way to get a production-ready node deployed on a server is to run our [Psinode docker image](https://github.com/gofractally/psinode-docker-image) in a container orchestration environment such as [Docker Swarm](https://docs.docker.com/engine/swarm/). The following instructions will show how easy it is to deploy a single-node swarm to manage a production Psinode deployment. Your server should be running Ubuntu 20.04 or later.

## Install Docker

Install the Docker engine on your server. Instructions for installing on Ubuntu can be found [here](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository).

## Add user to root docker group

It's not a good practice to use the `root` user on your server. However, because of the [lack of support](https://docs.docker.com/engine/security/rootless/#known-limitations) for overlay networks in Docker's "rootless mode," and Docker Swarm's reliance on the overlay networks, we must run Docker as root.

In order to run Docker commands from your non-root server user without constantly elevating permissions with `sudo`, add your user to the Docker group:
1. Create docker group: `sudo groupadd docker`
2. Add user to new group: `sudo usermod -aG docker USER`
3. Reboot: `reboot`

Now you should be able to run commands like `docker container ls` without getting a permissions error.

## Create admin password

The Psinode admin area allows for remote node configuration. It should not be accessible to the outside world. In order to achieve this, we can use `apache2-utils` to create a user and hashed password. The file should be stored at `/home/ubuntu/nginx/.htpasswd". This path will eventually get mounted into the nginx container.

1. Install the tool: `sudo apt-get update && sudo apt-get install apache2-utils`
2. Create the password: `htpasswd -c ./nginx/.htpasswd <USER>`

## Configure DNS

If you want auto-certificate renewal, you must use one of the DNS providers with a corresponding Certbot DNS plugin. All Certbot DNS plugins are listed [here](https://eff-certbot.readthedocs.io/en/stable/using.html#dns-plugins).

Follow the instructions on the corresponding plugin that describe how to configure your DNS provider. This allows LetsEncrypt to issue a wildcard certificate to your server.

### Automatically renew cert

Because certbot and Nginx are running in different containers, the host machine must coordinate the renewal of the certificates and the subsequent restarting of the nginx service.

Add a cron job to the host machine that calls a script that does the above tasks.

## Configure docker stack environment

Fill out all variables in the stack-deployment-config.env file with your configuration.

## Deploy single node swarm

We have provided a docker stack file to make this deployment easy. It deploys psinode and nginx on your server and uses the environment variables to configure each.

### Todo

Figure out how to handle secrets and transfer them properly into the docker containers. Not just env configurations, but actual secrets.

Figure out the instructions for getting certbot to issue a certificate.

Figure out the instructions for adding auto-renew cron-job.

### Customize

TODO
1. Deploy docs
2. Deploy site
