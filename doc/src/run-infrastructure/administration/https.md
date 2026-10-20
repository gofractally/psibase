# Serving https

For local/development infrastructure, psinode [supports TLS](../cli/psinode.md#tls-options) directly.

For production deployments of psibase, web traffic can be routed through a reverse proxy. The exact instructions are specific to your OS and domain provider. This document should serve as a reference for the general steps you would be required to follow.

If you're on a linux distribution, it's highly likely you can use [nginx](http://nginx.org/) and [certbot](https://certbot.eff.org/) to add https support to `psinode`, as long as your DNS is [supported](https://eff-certbot.readthedocs.io/en/stable/using.html#dns-plugins) by a certbot plugin.

Certbot provides certificates using [Let's Encrypt](https://letsencrypt.org/).

## Domain

You need to add 2 DNS entried (A records). One for the domain at which you're hosting psibase, and one wildcard domain (`*.your-domain.com`).

## Create a certificate

Create a wildcard certificate for your site. It is highly recommended that you use automatic certificate renewal to avoid your node experiencing down-time from an expired certificate.

If you use `certbot` to create the certificate, you may need a credential file that you should be able to generate on your DNS provider website (As seen in the [Google DNS plugin](https://certbot-dns-google.readthedocs.io/en/stable/#credentials), for example). 

## Configure reverse proxy

Configure a reverse proxy to forward https traffic to your instance of `psinode` running on your server. `psinode` itself can be simply configured to run over http as long as it's sitting behind a reverse proxy that handles the `https` traffic.

## Lock down access

It is recommended that you don't publicly expose the port on which `psinode` is listening. All requests should go through the reverse proxy. 

Access to the [x-admin](../../default-apps/x-admin.md) default app should be carefully restricted, as it essentially provides full admin access to the node.

## Configure psinode host

Web requests are going to be forwarded from the reverse proxy into the psinode process, so make sure psinode is also configured with the correct host. This can either be done at the time you launch psinode using the [-o option](../cli/psinode.md#general-options) (e.g. `-o psibase.io`) or by using the `host` configuration option in the [x-admin](../../default-apps/x-admin.md#host) default app.
