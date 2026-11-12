# Reference container image for Alice Kotlin backend (JVM distribution).
# Build context: backend-kt.
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

# Expect a prebuilt install distribution at server/build/install/server
# (run: cd backend-kt && ./gradlew :server:installDist)
COPY server/build/install/server/ /app/

# Run as an unprivileged user; /data is the only place it writes.
RUN useradd --system --uid 10001 --no-create-home alice \
    && mkdir -p /data \
    && chown -R alice /data
USER alice

ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3002
ENV DATABASE_PATH=/data/alice.db

VOLUME ["/data"]
EXPOSE 3002

# No curl needed: bash can open the socket itself.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/${SERVER_PORT}; printf "GET /health HTTP/1.0\r\n\r\n" >&3; head -n 1 <&3 | grep -q " 200 "'

# The config worker (alice-worker) runs as a second container; see docker-compose.yml.
CMD ["/app/bin/server"]
