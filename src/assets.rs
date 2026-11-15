//! The front-end build (`web/dist`), embedded into the binary at compile time.
//! A debug build reads the folder from disk instead, so `npm run build` is picked up
//! without recompiling. If the folder was missing at build time the page says so.

use axum::Router;
use axum::extract::Path;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/dist"]
#[allow_missing = true]
struct Dist;

pub fn router() -> Router {
    Router::new()
        .route("/", get(index))
        .route("/{*path}", get(file))
}

async fn index() -> Response {
    match Dist::get("index.html") {
        Some(f) => with_type(f.data.into_owned(), "index.html", "no-cache"),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "The front-end was not built into this binary: run `npm run build` in web/ \
             and build again.",
        )
            .into_response(),
    }
}

async fn file(Path(path): Path<String>) -> Response {
    // Unknown paths under /api reach this catch-all; answer them as the API would.
    if path == "api" || path.starts_with("api/") {
        return crate::api::not_found();
    }
    if path == "index.html" {
        return index().await;
    }
    match Dist::get(&path) {
        // Vite puts a content hash in every file name under assets/.
        Some(f) if path.starts_with("assets/") => with_type(
            f.data.into_owned(),
            &path,
            "public, max-age=31536000, immutable",
        ),
        Some(f) => with_type(f.data.into_owned(), &path, "no-cache"),
        None => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "not found",
        )
            .into_response(),
    }
}

fn with_type(body: Vec<u8>, path: &str, cache: &'static str) -> Response {
    let mut res = body.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime(path)));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "json" | "map" => "application/json",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
