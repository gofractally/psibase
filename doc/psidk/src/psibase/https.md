# Serving https

These instructions cover using [nginx](http://nginx.org/) and [Let's Encrypt](https://letsencrypt.org/) to add https support to `psinode`.

psinode doesn't support https itself. It would create several complications if it did:

- psinode's binary release supports multiple distributions. Unfortunately different distributions have incompatible versions of the OpenSSL library. About the only way to resolve that is to statically link OpenSSL, which makes it hard to keep up with its security fixes.
- Since psinode hosts a variable set of subdomains, https requires wildcard certificates. Let's Encrypt's wildcard certificates require a periodic dance between the https server, the Let's Encrypt API, and DNS entries to confirm ownership of the domain. `certbot` knows how to do this dance using `nginx`.

These instructions cover using GoDaddy. Unfortunately every DNS provider needs a different `certbot` plugin to support wildcard certificates; see [this issue](https://github.com/certbot/certbot/issues/6178). If you're using a different DNS provider, then check the lists at [DNS Plugins](https://eff-certbot.readthedocs.io/en/stable/using.html#dns-plugins) and [Third-party plugins](https://eff-certbot.readthedocs.io/en/stable/using.html#third-party-plugins). We're using the [dns-godaddy plugin](https://github.com/miigotu/certbot-dns-godaddy).

These instructions cover using Ubuntu 22.04.

## Domain

The rest of these instructions assume you're hosting on `my-psinode-domain.com`; adjust them to your domain. You need 2 DNS entries (A records): one for the domain and one for the wildcard (`*`).

## Install packages

This assumes you've already followed the [Linux Installation](../linux.md) guide, including the Ubuntu 22.04 instructions. We're using `pip` packages instead of `snap` packages since, as of this writing, `certbot-dns-godaddy` [doesn't function correctly](https://github.com/miigotu/certbot-dns-godaddy/issues/6) when using the `certbot` snap package.

Make sure certbot isn't already installed: `which certbot`. If it is, uninstall it or it will conflict with these instructions.

Run the following as `root`:

```
apt-get update
apt-get -y install nginx python3 python3-venv libaugeas0
python3 -m venv /opt/certbot/
/opt/certbot/bin/pip install --upgrade pip
/opt/certbot/bin/pip install certbot certbot-nginx certbot-dns-godaddy
ln -s /opt/certbot/bin/certbot /usr/bin/certbot
```

## GoDaddy credentials

`certbot-dns-godaddy` needs a credentials file from [developer.godaddy.com/keys](https://developer.godaddy.com/keys). This allows it to respond to DNS challenges from Let's Encrypt. Select "Production"; "ote" (the default) won't work. The file looks like the following:

```
dns_godaddy_secret = 0123456789abcdef0123456789abcdef01234567
dns_godaddy_key = abcdef0123456789abcdef01234567abcdef0123
```

Protect this file! It should only be readable by `root`. `certbot` runs periodically to renew wildcard certificates and it fetches the credentials from this file each time.

## Creating the certificate

Run the following as root. If this process succeeds, `certbot` will create the certificate in `/etc/letsencrypt/live/my-psinode-domain.com/`.

Adjust the arguments to point to your credentials file, use your email address, and use your domain.

```
certbot \
  --authenticator dns-godaddy \
  --installer nginx \
  --email email_goes_here@email_goes_here \
  --agree-tos \
  -d 'my-psinode-domain.com,*.my-psinode-domain.com' \
  --dns-godaddy-credentials /root/.secrets/certbot/godaddy.ini \
  --dns-godaddy-propagation-seconds 900 \
  --keep-until-expiring \
  --non-interactive \
  --expand
```

Ignore this message:

```
Missing command line flag or config entry for this setting:
Which server blocks would you like to modify?
```

## Auto renew

First, test renew works:

```
certbot --dry-run renew
```

If this operates correctly, schedule auto renewal:

```
echo "0 0,12 * * * root /opt/certbot/bin/python -c 'import random; import time; time.sleep(random.random() * 3600)' && certbot renew -q" | tee -a /etc/crontab > /dev/null
```

Twice a day, at 0:00 and 12:00, this will wait randomly up to 1 hour then run auto renewal.

## Upgrade certbot

Update certbot every once in a while, e.g. when you update your system packages.

```
/opt/certbot/bin/pip install --upgrade certbot certbot-nginx certbot-dns-godaddy
```

## Configure nginx

Create `/etc/nginx/sites-available/psinode`. Replace `my-psinode-domain.com` with your domain.

```
server {
    listen 443 ssl;

    # This includes both the domain and subdomains
    server_name             my-psinode-domain.com *.my-psinode-domain.com;

    ssl_certificate         /etc/letsencrypt/live/my-psinode-domain.com/fullchain.pem;
    ssl_certificate_key     /etc/letsencrypt/live/my-psinode-domain.com/privkey.pem;
    include                 /etc/letsencrypt/options-ssl-nginx.conf;

    # Allow larger upload than nginx's default
    client_max_body_size    2m;

    location / {
        proxy_pass       http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Deny public access to the /native/admin interface
    # Note: this is only effective if port 8080 isn't publicly exposed
    location /native/admin {
        deny all;
        return 403;
    }

    # Optional; deny incoming p2p requests
    # Note: this is only effective if port 8080 isn't publicly exposed
    # location /native/p2p {
    #     deny all;
    #     return 403;
    # }
}
```

To enable it:

```
ln -s /etc/nginx/sites-available/psinode /etc/nginx/sites-enabled/psinode

service nginx restart
```

## Running psinode

psinode needs to know what domain it's being hosted at. Use its `-o/--host` option:

```
psinode -o my-psinode-domain.com remaining_options...
```
