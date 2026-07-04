FROM postgres:16-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-16-pgvector build-essential postgresql-server-dev-16 ca-certificates curl \
 && curl -fsSL https://github.com/pgbigm/pg_bigm/archive/refs/tags/v1.2-20240606.tar.gz | tar -xz -C /tmp \
 && cd /tmp/pg_bigm-1.2-20240606 && make USE_PGXS=1 && make USE_PGXS=1 install \
 && apt-get purge -y build-essential postgresql-server-dev-16 curl \
 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/pg_bigm*
