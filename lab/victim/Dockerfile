FROM debian:bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        openssh-server \
        rsyslog \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash labuser \
    && mkdir -p /run/sshd /etc/ssh/sshd_config.d \
    && rm -f /etc/ssh/ssh_host_*

COPY rsyslog.conf /etc/rsyslog.conf
COPY sshd-lab.conf /etc/ssh/sshd_config.d/lab.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod 0755 /usr/local/bin/entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
