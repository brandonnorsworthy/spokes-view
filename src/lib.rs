//! spokes-view: a read-only web view of a Spokes to-do tree.
//!
//! One axum service: it serves the page (the React build in `web/dist`, embedded into
//! the binary) and the page's JSON API (`api.rs`), which calls the configured Spokes
//! servers' `/api` server to server.

pub mod api;
pub mod assets;
pub mod config;
pub mod upstream;

use std::future::Future;
use std::time::Instant;

use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;

use crate::config::Config;

/// The whole app: `/health`, `/api/...` and the page.
pub fn app(config: &Config) -> anyhow::Result<Router> {
    let state = api::AppState::new(config)?;
    Ok(Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/api", api::router(state))
        .merge(assets::router())
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(log_request)))
}

/// Serves until `shutdown` completes.
pub async fn serve(
    listener: tokio::net::TcpListener,
    config: &Config,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    axum::serve(listener, app(config)?)
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}

/// One line per request: method, path and query, status, time taken.
async fn log_request(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let start = Instant::now();
    let res = next.run(req).await;
    let status = res.status().as_u16();
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    if uri.path() == "/health" {
        tracing::debug!(%method, uri = %uri, status, ms = format_args!("{ms:.1}"), "request");
    } else {
        tracing::info!(%method, uri = %uri, status, ms = format_args!("{ms:.1}"), "request");
    }
    res
}

/// The page loads only its own files and calls only its own API.
async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; \
             connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; \
             form-action 'none'",
        ),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    res
}
