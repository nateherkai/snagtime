FROM postgres:18.6-bookworm@sha256:7d2695c3aa88e792e8b3b233e7e4adb296a20412c6c0ca361e3edaaacfada108
COPY --chmod=0755 infrastructure/postgresql/secure-entrypoint.sh /usr/local/bin/tempocove-secure-entrypoint
COPY --chmod=0444 infrastructure/postgresql/pg_hba.conf /etc/postgresql/tempocove-pg_hba.conf
ENTRYPOINT ["/usr/local/bin/tempocove-secure-entrypoint"]
CMD ["postgres"]
