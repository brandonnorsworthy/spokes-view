# syntax=docker/dockerfile:1

# ---- front-end ----
FROM node:26-trixie-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

# ---- build ----
FROM rust:1.100-slim-trixie AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
# The release binary embeds web/dist (rust-embed).
COPY --from=web /web/dist ./web/dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
    && cp target/release/spokes-view /spokes-view

# ---- runtime ----
# Distroless with glibc: no shell, no package manager, runs as uid 65532 (nonroot).
FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=build /spokes-view /usr/local/bin/spokes-view
ENV SPOKES_VIEW_BIND=0.0.0.0:8788
USER 65532:65532
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/spokes-view", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/spokes-view"]
