//! The page's own JSON API under `/api`. Thin: it validates everything the browser
//! sends, looks the server up by name in the configuration and passes the Spokes
//! answer through (with its ETag, and a 304 when the browser's tag is still current).
//!
//! - `GET /api/servers`: the configured names, each probed for status and version.
//! - `GET /api/servers/{name}/tree?root=&depth=&include_closed=`: a tree slice.
//! - `GET /api/servers/{name}/nodes/{id}?include_closed=`: one node with notes.
//!
//! - `GET /api/servers/{name}/history?root=`: the replay history of a subtree (Spokes 0.4.0+).
//! - `GET /api/servers/{name}/search?q=&limit=&include_closed=&scope=`: fuzzy search (Spokes 0.5.0+).
//!
//! Errors are `{"error": "...", "code": "..."}` with `code` one of `bad_request`,
//! `unknown_server`, `not_found`, `unreachable`, `too_old`, `history_unsupported`,
//! `search_unsupported`, `upstream_error`.

use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Serialize;

use crate::config::{Config, Server};
use crate::upstream::{self, Passthrough, UpstreamError};

/// Deepest slice Spokes serves.
pub const MAX_DEPTH: i64 = 10;
/// Default slice depth, as in Spokes.
pub const DEFAULT_DEPTH: i64 = 3;
/// Largest node id accepted (ids are SQLite rowids; keep them exact in JavaScript).
pub const MAX_ID: i64 = (1 << 53) - 1;

#[derive(Clone)]
pub struct AppState {
    servers: Arc<Vec<Server>>,
    client: reqwest::Client,
}

impl AppState {
    pub fn new(config: &Config) -> anyhow::Result<AppState> {
        Ok(AppState {
            servers: Arc::new(config.servers.clone()),
            client: upstream::client()?,
        })
    }

    fn server(&self, name: &str) -> Result<&Server, ApiError> {
        self.servers
            .iter()
            .find(|s| s.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::NOT_FOUND,
                    "unknown_server",
                    format!("no server named '{}' is configured", clip(name)),
                )
            })
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/servers", get(servers))
        .route("/servers/{name}/tree", get(tree))
        .route("/servers/{name}/nodes/{id}", get(node))
        .route("/servers/{name}/history", get(history))
        .route("/servers/{name}/search", get(search))
        .fallback(|| async { not_found() })
        .method_not_allowed_fallback(|| async {
            ApiError::new(
                StatusCode::METHOD_NOT_ALLOWED,
                "bad_request",
                "the API is read-only; use GET",
            )
        })
        .with_state(state)
}

/// The JSON 404 for an unknown path under `/api`.
pub fn not_found() -> Response {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "no such endpoint").into_response()
}

/// `{"error", "code"}` with a status.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> ApiError {
        ApiError {
            status,
            code,
            message: message.into(),
        }
    }

    fn bad(message: impl Into<String>) -> ApiError {
        ApiError::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        #[derive(Serialize)]
        struct Body<'a> {
            error: &'a str,
            code: &'a str,
        }
        let mut res = (
            self.status,
            Json(Body {
                error: &self.message,
                code: self.code,
            }),
        )
            .into_response();
        res.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        res
    }
}

fn upstream_error(server: &Server, e: UpstreamError, what: &str) -> ApiError {
    let name = &server.name;
    match e {
        UpstreamError::Unreachable(why) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "unreachable",
            format!("the Spokes server '{name}' is unreachable: {why}"),
        ),
        UpstreamError::TooOld => {
            ApiError::new(StatusCode::BAD_GATEWAY, "too_old", upstream::TOO_OLD)
        }
        UpstreamError::NotFound(_) => ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("{what} is not in the tree on '{name}' (it may be closed or gone)"),
        ),
        UpstreamError::Other(why) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "upstream_error",
            format!("'{name}': {why}"),
        ),
    }
}

/// At most 60 characters of browser input, for error messages.
fn clip(s: &str) -> String {
    let mut out: String = s.chars().take(60).collect();
    if s.chars().count() > 60 {
        out.push('…');
    }
    out
}

/// Query parameters by name; unknown or repeated names are refused.
fn params(
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
    known: &[&str],
) -> Result<HashMap<String, String>, ApiError> {
    let Query(pairs) = query.map_err(|_| ApiError::bad("bad query string"))?;
    let mut out = HashMap::new();
    for (k, v) in pairs {
        if !known.contains(&k.as_str()) {
            return Err(ApiError::bad(format!(
                "unknown parameter '{}'; this endpoint takes {}",
                clip(&k),
                known.join(", ")
            )));
        }
        if out.insert(k.clone(), v).is_some() {
            return Err(ApiError::bad(format!(
                "parameter '{k}' is given more than once"
            )));
        }
    }
    Ok(out)
}

/// `SPOKE-12`, `spoke-12` or `12`.
pub fn parse_id(value: &str, name: &str) -> Result<i64, ApiError> {
    let v = value.trim();
    let digits = if v.len() > 6 && v[..6].eq_ignore_ascii_case("SPOKE-") {
        &v[6..]
    } else {
        v
    };
    digits
        .parse::<i64>()
        .ok()
        .filter(|n| (1..=MAX_ID).contains(n) && digits.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| {
            ApiError::bad(format!(
                "{name} '{}' is not a node id; use SPOKE-12 or 12",
                clip(value)
            ))
        })
}

pub fn parse_depth(value: Option<&String>) -> Result<i64, ApiError> {
    match value {
        None => Ok(DEFAULT_DEPTH),
        Some(v) => v
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|d| (0..=MAX_DEPTH).contains(d))
            .ok_or_else(|| {
                ApiError::bad(format!(
                    "depth must be a whole number from 0 to {MAX_DEPTH}"
                ))
            }),
    }
}

pub fn parse_bool(value: Option<&String>, name: &str) -> Result<bool, ApiError> {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None => Ok(false),
        Some("true" | "1") => Ok(true),
        Some("false" | "0") => Ok(false),
        Some(_) => Err(ApiError::bad(format!("{name} must be true or false"))),
    }
}

/// The browser's `If-None-Match`, if it looks like entity tags (printable ASCII, short).
fn if_none_match(headers: &HeaderMap) -> Option<HeaderValue> {
    headers
        .get(header::IF_NONE_MATCH)
        .filter(|v| v.len() <= 512 && v.as_bytes().iter().all(|b| (0x20..0x7f).contains(b)))
        .cloned()
}

fn accepts_gzip(headers: &HeaderMap) -> bool {
    headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .any(|e| {
            let mut parts = e.split(';');
            let coding = parts.next().unwrap_or("").trim();
            let refused = parts.any(|p| {
                let p = p.trim().replace(' ', "");
                p == "q=0" || p == "q=0.0" || p == "q=0.00" || p == "q=0.000"
            });
            coding.eq_ignore_ascii_case("gzip") && !refused
        })
}

fn pass(p: Passthrough) -> Response {
    let mut res = if p.status == StatusCode::NOT_MODIFIED {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        let mut res = p.body.into_response();
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        if let Some(enc) = p.content_encoding {
            res.headers_mut().insert(header::CONTENT_ENCODING, enc);
        }
        res
    };
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    h.insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
    if let Some(tag) = p.etag {
        h.insert(header::ETAG, tag);
    }
    res
}

#[derive(Serialize)]
struct ServerEntry {
    name: String,
    /// `ok`, `unreachable`, `too_old` or `error`.
    status: &'static str,
    version: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
struct ServerList {
    servers: Vec<ServerEntry>,
}

async fn servers(
    State(state): State<AppState>,
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<Response, ApiError> {
    params(query, &[])?;
    // Probe every server at once, so one slow server costs one timeout, not several.
    let handles: Vec<_> = state
        .servers
        .iter()
        .map(|s| {
            let (client, server) = (state.client.clone(), s.clone());
            tokio::spawn(async move { upstream::probe(&client, &server).await })
        })
        .collect();
    let mut results = Vec::with_capacity(handles.len());
    for h in handles {
        results.push(h.await.unwrap_or_else(|_| upstream::Probe {
            status: "error",
            version: None,
            message: Some("internal error".into()),
        }));
    }
    let servers = state
        .servers
        .iter()
        .zip(results)
        .map(|(s, p)| ServerEntry {
            name: s.name.clone(),
            status: p.status,
            version: p.version,
            message: p.message,
        })
        .collect();
    let mut res = Json(ServerList { servers }).into_response();
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(res)
}

async fn tree(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<Response, ApiError> {
    let server = state.server(&name)?;
    let p = params(query, &["root", "depth", "include_closed"])?;
    let root = match p.get("root") {
        None => 1,
        Some(v) => parse_id(v, "root")?,
    };
    let depth = parse_depth(p.get("depth"))?;
    let include_closed = parse_bool(p.get("include_closed"), "include_closed")?;
    let path = format!("/api/tree?root={root}&depth={depth}&include_closed={include_closed}");
    upstream::get(
        &state.client,
        server,
        &path,
        if_none_match(&headers).as_ref(),
        accepts_gzip(&headers),
    )
    .await
    .map(pass)
    .map_err(|e| upstream_error(server, e, &format!("SPOKE-{root}")))
}

async fn node(
    State(state): State<AppState>,
    Path((name, id)): Path<(String, String)>,
    headers: HeaderMap,
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<Response, ApiError> {
    let server = state.server(&name)?;
    let id = parse_id(&id, "id")?;
    let p = params(query, &["include_closed"])?;
    let include_closed = parse_bool(p.get("include_closed"), "include_closed")?;
    let path = format!("/api/nodes/{id}?include_closed={include_closed}");
    upstream::get(
        &state.client,
        server,
        &path,
        if_none_match(&headers).as_ref(),
        accepts_gzip(&headers),
    )
    .await
    .map(pass)
    .map_err(|e| upstream_error(server, e, &format!("SPOKE-{id}")))
}

/// Shown when a Spokes server answers `/api/history` with "no such endpoint".
const HISTORY_UNSUPPORTED: &str = "this Spokes server is older than 0.4.0 and has no history API";

async fn history(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<Response, ApiError> {
    let server = state.server(&name)?;
    let p = params(query, &["root"])?;
    let (path, what) = match p.get("root") {
        None => ("/api/history".to_string(), "the tree".to_string()),
        Some(v) => {
            let root = parse_id(v, "root")?;
            (format!("/api/history?root={root}"), format!("SPOKE-{root}"))
        }
    };
    upstream::get(
        &state.client,
        server,
        &path,
        if_none_match(&headers).as_ref(),
        accepts_gzip(&headers),
    )
    .await
    .map(pass)
    .map_err(|e| match e {
        UpstreamError::NotFound(msg) if upstream::is_missing_endpoint(&msg) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "history_unsupported",
            HISTORY_UNSUPPORTED,
        ),
        e => upstream_error(server, e, &what),
    })
}

/// Shown when a Spokes server answers `/api/search` with "no such endpoint".
const SEARCH_UNSUPPORTED: &str = "this Spokes server is older than 0.5.0 and has no search API";

/// Longest search text Spokes accepts, in characters.
const MAX_QUERY_CHARS: usize = 200;
/// Most results Spokes returns.
const MAX_SEARCH_LIMIT: i64 = 50;

/// Percent-encodes every byte outside the unreserved set (`A-Z a-z 0-9 - . _ ~`).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

async fn search(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<Response, ApiError> {
    let server = state.server(&name)?;
    let p = params(query, &["q", "limit", "include_closed", "scope"])?;
    let q = p
        .get("q")
        .ok_or_else(|| ApiError::bad("q is required"))?
        .trim();
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err(ApiError::bad(format!(
            "q must be at most {MAX_QUERY_CHARS} characters"
        )));
    }
    if !q.chars().any(char::is_alphanumeric) {
        return Err(ApiError::bad("q must contain a letter or a digit"));
    }
    let limit = match p.get("limit") {
        None => None,
        Some(v) => Some(
            v.trim()
                .parse::<i64>()
                .ok()
                .filter(|n| (1..=MAX_SEARCH_LIMIT).contains(n))
                .ok_or_else(|| {
                    ApiError::bad(format!(
                        "limit must be a whole number from 1 to {MAX_SEARCH_LIMIT}"
                    ))
                })?,
        ),
    };
    let include_closed = parse_bool(p.get("include_closed"), "include_closed")?;
    let scope = match p.get("scope") {
        None => None,
        Some(v) => Some(parse_id(v, "scope")?),
    };
    let mut path = format!("/api/search?q={}", percent_encode(q));
    if let Some(limit) = limit {
        path.push_str(&format!("&limit={limit}"));
    }
    if include_closed {
        path.push_str("&include_closed=true");
    }
    if let Some(scope) = scope {
        path.push_str(&format!("&scope={scope}"));
    }
    let what = scope.map_or_else(|| "the tree".to_string(), |id| format!("SPOKE-{id}"));
    upstream::get(
        &state.client,
        server,
        &path,
        if_none_match(&headers).as_ref(),
        accepts_gzip(&headers),
    )
    .await
    .map(pass)
    .map_err(|e| match e {
        UpstreamError::NotFound(msg) if upstream::is_missing_endpoint(&msg) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "search_unsupported",
            SEARCH_UNSUPPORTED,
        ),
        e => upstream_error(server, e, &what),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encoding() {
        assert_eq!(percent_encode("fuzy serch"), "fuzy%20serch");
        assert_eq!(percent_encode("aZ09-._~"), "aZ09-._~");
        assert_eq!(percent_encode("a&b=c+d/é"), "a%26b%3Dc%2Bd%2F%C3%A9");
    }

    #[test]
    fn ids() {
        assert_eq!(parse_id("12", "id").unwrap(), 12);
        assert_eq!(parse_id("SPOKE-12", "id").unwrap(), 12);
        assert_eq!(parse_id("spoke-7", "id").unwrap(), 7);
        for bad in [
            "0",
            "-1",
            "+5",
            "SPOKE-",
            "x",
            "1.5",
            "99999999999999999999",
            "SPOKE--1",
        ] {
            assert!(parse_id(bad, "id").is_err(), "{bad}");
        }
    }

    #[test]
    fn depth_and_bools() {
        assert_eq!(parse_depth(None).unwrap(), 3);
        assert_eq!(parse_depth(Some(&"0".into())).unwrap(), 0);
        assert_eq!(parse_depth(Some(&"10".into())).unwrap(), 10);
        assert!(parse_depth(Some(&"11".into())).is_err());
        assert!(parse_depth(Some(&"-1".into())).is_err());
        assert!(parse_bool(Some(&"TRUE".into()), "x").unwrap());
        assert!(!parse_bool(Some(&"0".into()), "x").unwrap());
        assert!(parse_bool(Some(&"yes".into()), "x").is_err());
    }

    #[test]
    fn gzip_negotiation() {
        let h = |v: &str| {
            let mut m = HeaderMap::new();
            m.insert(header::ACCEPT_ENCODING, HeaderValue::from_str(v).unwrap());
            m
        };
        assert!(accepts_gzip(&h("gzip, deflate, br, zstd")));
        assert!(accepts_gzip(&h("br;q=1.0, gzip;q=0.8")));
        assert!(!accepts_gzip(&h("gzip;q=0")));
        assert!(!accepts_gzip(&h("identity")));
        assert!(!accepts_gzip(&HeaderMap::new()));
    }
}
