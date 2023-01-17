FROM ghcr.io/gofractally/psibase-ubuntu-2004-builder:latest

RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -yq curl wget unzip supervisor \
    && apt-get clean -yq \
    && rm -rf /var/lib/apt/lists/*

RUN cd /root \
 && wget https://github.com/gofractally/psibase/releases/download/rolling-release/psidk-ubuntu-2004.tar.gz \
 && tar xf psidk-ubuntu-2004.tar.gz \
 && rm psidk-ubuntu-2004.tar.gz \ 
 && ls -l \
 && mv psidk-ubuntu-2004 psidk \
 && wget https://github.com/fstab/grok_exporter/releases/download/v1.0.0.RC5/grok_exporter-1.0.0.RC5.linux-amd64.zip \
 && unzip grok_exporter-*.zip \
 && wget https://github.com/vi/websocat/releases/download/v1.11.0/websocat.aarch64-unknown-linux-musl \
 && chmod a+x websocat.aarch64-unknown-linux-musl \
 && wget https://github.com/prometheus-community/json_exporter/releases/download/v0.5.0/json_exporter-0.5.0.linux-amd64.tar.gz \
 && tar -xzvf json_exporter-0.5.0.linux-amd64.tar.gz

RUN mkdir -p /var/log/supervisord

ENV PSIDK_PREFIX=/root/psidk

ENV PATH=/root/psidk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /root

CMD supervisord -c /root/supervisord.conf
