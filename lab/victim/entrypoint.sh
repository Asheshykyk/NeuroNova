#!/bin/sh
set -eu

if [ -z "${LAB_SSH_PASSWORD:-}" ]; then
    echo "ERROR: LAB_SSH_PASSWORD is unset or empty" >&2
    exit 1
fi

printf 'labuser:%s\n' "$LAB_SSH_PASSWORD" | chpasswd

mkdir -p /run/sshd /var/log
touch /var/log/auth.log
chmod 0640 /var/log/auth.log

/usr/sbin/rsyslogd
/usr/bin/ssh-keygen -A
/usr/sbin/sshd -t
exec /usr/sbin/sshd -D
