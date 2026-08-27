#!/bin/sh
set -eu
install -d -m 0700 -o postgres -g postgres /var/lib/postgresql/tls
install -m 0600 -o postgres -g postgres /run/secrets/postgres_server_key /var/lib/postgresql/tls/server.key
install -m 0644 -o postgres -g postgres /run/secrets/postgres_server_cert /var/lib/postgresql/tls/server.crt
install -m 0644 -o postgres -g postgres /run/secrets/postgres_ca_cert /var/lib/postgresql/tls/ca.crt
exec /usr/local/bin/docker-entrypoint.sh "$@" -c ssl=on -c ssl_min_protocol_version=TLSv1.3 -c ssl_cert_file=/var/lib/postgresql/tls/server.crt -c ssl_key_file=/var/lib/postgresql/tls/server.key -c ssl_ca_file=/var/lib/postgresql/tls/ca.crt -c hba_file=/etc/postgresql/tempocove-pg_hba.conf -c password_encryption=scram-sha-256
