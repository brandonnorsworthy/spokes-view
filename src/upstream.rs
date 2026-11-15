//! Calls to the Spokes servers' read-only `/api`, server to server.
//!
//! Only paths built here from validated values are ever requested, against base URLs
//! from the configuration: nothing the browser sends becomes part of a URL except
//! numbers and booleans that have already been parsed.

use std::time::Duration;

use axum::body::Bytes;
use axum::http::{HeaderValue, StatusCode, header};
use serde::Deserialize;

use crate::config::Server;

/// How long to wait for a TCP connection.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Whole-request limit for tree slices and node detail.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Whole-request limit for the reachability probe in the server list.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// Largest upstream body accepted (a 2000-node slice is about 1.1 MB).
pub const MAX_BODY: usize = 32 * 1024 * 1024;

/// What went wrong talking to a Spokes server.
#[derive(Debug)]
pub enum UpstreamError {
    /// No connection, a timeout, or a broken response.
    Unreachable(String),
    /// `/health` answers but `/api` does not exist: a Spokes older than 0.2.0.
    TooOld,
    /// The server answered 404 with its own JSON error (an unknown node).
    NotFound,
    /// Anything else unexpected (a 403 from its Host/Origin rules, a 500, ...).
    Other(String),
}

/// A response to hand back to the browser as is.
pub struct Passthrough {
    /// 200 or 304.
    pub status: StatusCode,
    pub etag: Option<HeaderValue>,
    pub content_encoding: Option<HeaderValue>,
    pub body: Bytes,
}

pub fn client() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("spokes-view/", env!("CARGO_PKG_VERSION")))
        .build()?)
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "the request timed out".into()
    } else if e.is_connect() {
        "could not connect".into()
    } else {
        "the connection failed".into()
    }
}

/// GETs `path` (starting with `/api/`) from `server`, forwarding `If-None-Match` and
/// asking for gzip only when the browser accepts it (the body is passed through
/// still compressed).
pub async fn get(
    client: &reqwest::Client,
    server: &Server,
    path: &str,
    if_none_match: Option<&HeaderValue>,
    accept_gzip: bool,
) -> Result<Passthrough, UpstreamError> {
    let mut req = client.get(format!("{}{path}", server.base));
    if let Some(tag) = if_none_match {
        req = req.header(header::IF_NONE_MATCH, tag.clone());
    }
    req = req.header(
        header::ACCEPT_ENCODING,
        if accept_gzip { "gzip" } else { "identity" },
    );
    let mut res = req
        .send()
        .await
        .map_err(|e| UpstreamError::Unreachable(describe(&e)))?;
    let status = res.status();
    match status {
        StatusCode::OK | StatusCode::NOT_MODIFIED => {
            let etag = res.headers().get(header::ETAG).cloned();
            let content_encoding = res.headers().get(header::CONTENT_ENCODING).cloned();
            let body = if status == StatusCode::OK {
                read_body(&mut res).await?
            } else {
                Bytes::new()
            };
            Ok(Passthrough {
                status,
                etag,
                content_encoding,
                body,
            })
        }
        StatusCode::NOT_FOUND => {
            // Spokes 0.2.0+ answers an unknown node with a JSON error; a 0.1.0 server
            // has no /api at all and answers with an empty, untyped 404.
            if is_json(res.headers()) {
                Err(UpstreamError::NotFound)
            } else {
                Err(classify_missing_api(client, server).await)
            }
        }
        StatusCode::FORBIDDEN => Err(UpstreamError::Other(
            "the Spokes server refused the request (403); check SPOKES_ALLOWED_HOSTS on it".into(),
        )),
        s => Err(UpstreamError::Other(format!(
            "the Spokes server answered {}",
            s.as_u16()
        ))),
    }
}

fn is_json(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"))
}

async fn read_body(res: &mut reqwest::Response) -> Result<Bytes, UpstreamError> {
    if res.content_length().is_some_and(|n| n as usize > MAX_BODY) {
        return Err(UpstreamError::Other("the response is too large".into()));
    }
    let mut buf = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| UpstreamError::Unreachable(describe(&e)))?
    {
        if buf.len() + chunk.len() > MAX_BODY {
            return Err(UpstreamError::Other("the response is too large".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(Bytes::from(buf))
}

/// `/api` is missing: a Spokes that still answers `/health` is too old; otherwise this
/// is not a Spokes server we understand.
async fn classify_missing_api(client: &reqwest::Client, server: &Server) -> UpstreamError {
    let health = client
        .get(format!("{}/health", server.base))
        .timeout(PROBE_TIMEOUT)
        .send()
        .await;
    match health {
        Ok(r) if r.status() == StatusCode::OK => UpstreamError::TooOld,
        Ok(r) => UpstreamError::Other(format!(
            "no /api here and /health answered {}; is this a Spokes server?",
            r.status().as_u16()
        )),
        Err(e) => UpstreamError::Unreachable(describe(&e)),
    }
}

/// What the server list shows for one server.
pub struct Probe {
    pub status: &'static str,
    pub version: Option<String>,
    pub message: Option<String>,
}

/// Checks a server cheaply: the root alone (`depth=0`), uncompressed.
pub async fn probe(client: &reqwest::Client, server: &Server) -> Probe {
    #[derive(Deserialize)]
    struct Head {
        version: Option<String>,
    }
    let res = client
        .get(format!("{}/api/tree?depth=0", server.base))
        .header(header::ACCEPT_ENCODING, "identity")
        .timeout(PROBE_TIMEOUT)
        .send()
        .await;
    let fail = |status: &'static str, message: String| Probe {
        status,
        version: None,
        message: Some(message),
    };
    match res {
        Err(e) => fail("unreachable", describe(&e)),
        Ok(mut r) if r.status() == StatusCode::OK => match read_body(&mut r).await {
            Ok(body) => Probe {
                status: "ok",
                version: serde_json::from_slice::<Head>(&body)
                    .ok()
                    .and_then(|h| h.version),
                message: None,
            },
            Err(e) => from_error(e),
        },
        Ok(r) if r.status() == StatusCode::NOT_FOUND && !is_json(r.headers()) => {
            from_error(classify_missing_api(client, server).await)
        }
        Ok(r) => fail(
            "error",
            format!("the Spokes server answered {}", r.status().as_u16()),
        ),
    }
}

fn from_error(e: UpstreamError) -> Probe {
    let (status, message) = match e {
        UpstreamError::Unreachable(m) => ("unreachable", m),
        UpstreamError::TooOld => ("too_old", TOO_OLD.to_string()),
        UpstreamError::NotFound => ("error", "unexpected 404".to_string()),
        UpstreamError::Other(m) => ("error", m),
    };
    Probe {
        status,
        version: None,
        message: Some(message),
    }
}

/// The message for a Spokes 0.1.x server.
pub const TOO_OLD: &str = "this Spokes server is older than 0.2.0 and has no read API";
