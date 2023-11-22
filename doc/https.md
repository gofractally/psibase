# HTTPS

Some web technologies require a secure context when not operating over `localhost`. This includes things like clipboard access and WebRTC--two technologies used within the `FractalSys` app. For this reason, we need a means of running psinode with an SSL.

## Generating certs on local machine

1. Install `mkcert` locally on your host machine
   - on MacOS: `brew install mkcert nss`
   - on Linux:
     - `apt-get update; apt install libnss3-tools -y`
     - `wget https://github.com/FiloSottile/mkcert/releases/download/v1.4.3/mkcert-v1.4.3-linux-amd64`
     - `sudo cp mkcert-v1.4.3-linux-amd64 /usr/local/bin/mkcert`
     - `sudo chmod +x /usr/local/bin/mkcert`
   - Some references to help
     - [https://web.dev/how-to-use-local-https/](https://web.dev/how-to-use-local-https/)
     - [https://dev.to/rhymes/really-easy-way-to-use-https-on-localhost-341m](https://dev.to/rhymes/really-easy-way-to-use-https-on-localhost-341m)
     - [https://kifarunix.com/create-locally-trusted-ssl-certificates-with-mkcert-on-ubuntu-20-04/](https://kifarunix.com/create-locally-trusted-ssl-certificates-with-mkcert-on-ubuntu-20-04/)
2. Install `mkcert` as the local Certificate Authority: `mkcert -install`
3. Generate the cert and key, which will be deposited in the current directory: `mkcert psibase.127.0.0.1.sslip.io '*.psibase.127.0.0.1.sslip.io'`. Do not rename these files.

## Configuring psinode and running over HTTPS

1. Copy these files into the `psibase` project.
2. Create a file called `config` in a directory named `psinode_db_secure` with the following contents. Note the comments in the file.

If you're using the `psibase-contributor` dev container, the `/root/psibase/` is a the location used in the examples below. Place the cert/key files and `psinode_db_secure` directory there.

```sh
# psinode configuration
p2p                 = off
producer            = firstproducer
host                = psibase.127.0.0.1.sslip.io
service             = localhost:$PREFIX/share/psibase/services/admin-sys
admin               = static:*
database-size       = 8GiB
database-cache-size = 256MiB

# https settings
tls-cert            = /root/psibase/psibase.127.0.0.1.sslip.io+1.pem # modify if you placed these in a different location
tls-key             = /root/psibase/psibase.127.0.0.1.sslip.io+1-key.pem # modify if you placed these in a different location
listen              = https://0.0.0.0:8080
listen              = http://0.0.0.0:8079 # send local psibase cli commands to port 8079

[logger.stderr]
type   = console
filter = Severity >= info
format = [{TimeStamp}] [{Severity}]{?: [{RemoteEndpoint}]}: {Message}{?: {BlockId}}{?RequestMethod:: {RequestMethod} {RequestHost}{RequestTarget}{?: {ResponseStatus}{?: {ResponseBytes}}}}{?: {ResponseTime} µs}
```

3. From the `psibase` directory, start `psinode` with: `psinode psinode_db_secure`
4. Boot the chain with: `psibase -a http://psibase.127.0.0.1.sslip.io:8079 boot -p firstproducer`

If you're running `psinode` within a container, commands sent to psinode via the `psibase` command locally within the container must be sent to port `8079` without SSL. The node should now be accessible outside the container (assuming the ports are properly exposed) at `https://psibase.127.0.0.1.sslip.io:8080`.

## Notes & Caveats

- Firefox uses its own certificate store and may not pick up the mkcert certificates automatically.
- If you update apps, you will need to take additional action for the changes to be served by psinode. You have a couple options:
  1. After making your changes and rebuilding, delete the `db` file and `data` directory within the `psinode_db_secure` directory, restart psinode and boot the chain again. This will, of course, wipe the chain.
  2. Use the `psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload-tree` command to upload updated app build artifacts.

## Running an app server in dev mode for faster iteration

This uses the existing `FractalSys` app at `services/user/FractalSys/ui` as the example.

1. Create a copy of `.env.sample` named `.env` in the `ui` directory with `VITE_SECURE_LOCAL_DEV=true`
2. Verify that the `vite.config.ts` file points at the proper location for the SSL cert and key.
3. Run the dev server: `yarn dev`

Assuming port 8081 is properly exposed, psibase will now be accessible via port 8081 at https://psibase.127.0.0.1.sslip.io:8081 and the app will be accessible at its path (https://psibase.127.0.0.1.sslip.io:8081/app/fractal-sys in this case). Modifications to the app code should be reflected immediately via Vite's HMR.