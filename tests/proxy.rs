//! Starts the real service on a random port against stub Spokes servers (a 0.2.0 with
//! `/api`, a 0.1.0 without it, and a dead address) and drives it over HTTP.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Value, json};
use spokes_view::config::{Config, parse_servers};

/// What the stub saw: path + query, and selected headers.
#[derive(Default)]
struct Seen {
    requests: Vec<String>,
    origins: usize,
}

type Log = Arc<Mutex<Seen>>;

const TAG: &str = "W/\"t.1.3.0.boot.1.2.0.2026-11-15\"";

fn record(log: &Log, path: &str, q: &Option<String>, h: &HeaderMap) {
    let mut s = log.lock().unwrap();
    s.requests.push(match q {
        Some(q) => format!("{path}?{q}"),
        None => path.to_string(),
    });
    if h.contains_key(header::ORIGIN) {
        s.origins += 1;
    }
}

fn json_error(status: StatusCode, msg: &str) -> Response {
    (status, axum::Json(json!({ "error": msg }))).into_response()
}

async fn stub_tree(State(log): State<Log>, RawQuery(q): RawQuery, h: HeaderMap) -> Response {
    record(&log, "/api/tree", &q, &h);
    if q.as_deref().is_some_and(|q| q.contains("root=404")) {
        return json_error(StatusCode::NOT_FOUND, "SPOKE-404 does not exist");
    }
    if h.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(TAG) {
        return (StatusCode::NOT_MODIFIED, [(header::ETAG, TAG)]).into_response();
    }
    let body = json!({
        "rev": 7, "version": "0.2.0", "time_zone": "America/Chicago", "today": "2026-11-15",
        "root": 1, "depth": 3, "include_closed": false, "node_limit": 2000, "path": [],
        "truncated": false,
        "nodes": [{"id": 1, "parent": null, "title": "To do", "children_loaded": true}]
    });
    (
        [
            (header::ETAG, TAG),
            (header::CACHE_CONTROL, "no-cache"),
            (header::CONTENT_TYPE, "application/json"),
        ],
        body.to_string(),
    )
        .into_response()
}

async fn stub_node(
    State(log): State<Log>,
    Path(id): Path<String>,
    RawQuery(q): RawQuery,
    h: HeaderMap,
) -> Response {
    record(&log, &format!("/api/nodes/{id}"), &q, &h);
    if id != "3" {
        return json_error(StatusCode::NOT_FOUND, "no such node");
    }
    let body = json!({
        "rev": 7, "version": "0.2.0", "time_zone": "UTC", "today": "2026-11-15",
        "path": [{"id": 1, "title": "To do"}],
        "node": {"id": 3, "title": "Deploy", "notes": "the plan"},
        "events": []
    });
    ([(header::ETAG, "W/\"n.3\"")], axum::Json(body)).into_response()
}

async fn spawn(router: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    addr
}

/// A Spokes 0.2.0 stand-in.
async fn new_spokes(log: Log) -> SocketAddr {
    spawn(
        Router::new()
            .route("/health", get(|| async { "ok" }))
            .route("/api/tree", get(stub_tree))
            .route("/api/nodes/{id}", get(stub_node))
            .fallback(|| async { json_error(StatusCode::NOT_FOUND, "no such endpoint") })
            .with_state(log),
    )
    .await
}

/// A Spokes 0.1.0 stand-in: `/health` only, untyped empty 404 elsewhere.
async fn old_spokes() -> SocketAddr {
    spawn(Router::new().route("/health", get(|| async { "ok" }))).await
}

/// An address nothing listens on.
async fn dead_addr() -> SocketAddr {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    drop(l);
    addr
}

struct Env {
    base: String,
    log: Log,
    http: reqwest::Client,
}

async fn start() -> Env {
    let log: Log = Arc::default();
    let new = new_spokes(log.clone()).await;
    let old = old_spokes().await;
    let dead = dead_addr().await;
    let servers = parse_servers(&format!(
        "New=http://{new},Old=http://{old},Dead=http://{dead}"
    ))
    .unwrap();
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        servers,
    };
    let app = spokes_view::app(&config).unwrap();
    let addr = spawn(app).await;
    Env {
        base: format!("http://{addr}"),
        log,
        http: reqwest::Client::builder().no_proxy().build().unwrap(),
    }
}

impl Env {
    async fn get(&self, path: &str) -> reqwest::Response {
        self.http
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .unwrap()
    }

    async fn json(&self, path: &str) -> (StatusCode, Value) {
        let r = self.get(path).await;
        let status = r.status();
        let r = r.bytes().await.unwrap();
        let v = serde_json::from_slice(&r)
            .unwrap_or_else(|e| panic!("{path}: {status} {e}: {}", String::from_utf8_lossy(&r)));
        (status, v)
    }

    fn seen(&self) -> Vec<String> {
        self.log.lock().unwrap().requests.clone()
    }
}

#[tokio::test]
async fn health_and_page() {
    let env = start().await;
    let r = env.get("/health").await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.text().await.unwrap(), "ok");
    // The page is either the embedded build or a clear "not built" message.
    let r = env.get("/").await;
    assert!(
        r.status() == StatusCode::OK || r.status() == StatusCode::SERVICE_UNAVAILABLE,
        "{}",
        r.status()
    );
    assert!(r.headers().contains_key(header::CONTENT_SECURITY_POLICY));
    assert_eq!(env.get("/nope.js").await.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn server_list_shows_each_state_without_urls() {
    let env = start().await;
    let (status, v) = env.json("/api/servers").await;
    assert_eq!(status, StatusCode::OK);
    let s = v["servers"].as_array().unwrap();
    assert_eq!(s.len(), 3);
    assert_eq!(s[0]["name"], "New");
    assert_eq!(s[0]["status"], "ok");
    assert_eq!(s[0]["version"], "0.2.0");
    assert_eq!(s[1]["name"], "Old");
    assert_eq!(s[1]["status"], "too_old");
    assert_eq!(
        s[1]["message"],
        "this Spokes server is older than 0.2.0 and has no read API"
    );
    assert_eq!(s[2]["name"], "Dead");
    assert_eq!(s[2]["status"], "unreachable");
    assert!(
        !v.to_string().contains("127.0.0.1"),
        "URLs must not leak: {v}"
    );
}

#[tokio::test]
async fn tree_is_passed_through_with_canonical_parameters() {
    let env = start().await;
    let r = env.get("/api/servers/New/tree").await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()[header::ETAG], TAG);
    assert_eq!(r.headers()[header::CACHE_CONTROL], "no-cache");
    let v: Value = serde_json::from_slice(&r.bytes().await.unwrap()).unwrap();
    assert_eq!(v["nodes"][0]["title"], "To do");

    // Names match without case; ids accept the SPOKE- form; values are re-written.
    let r = env
        .get("/api/servers/new/tree?root=SPOKE-12&depth=1&include_closed=TRUE")
        .await;
    assert_eq!(r.status(), StatusCode::OK);
    let seen = env.seen();
    assert_eq!(seen[0], "/api/tree?root=1&depth=3&include_closed=false");
    assert_eq!(seen[1], "/api/tree?root=12&depth=1&include_closed=true");
}

#[tokio::test]
async fn not_modified_is_passed_through() {
    let env = start().await;
    let r = env
        .http
        .get(format!("{}/api/servers/New/tree", env.base))
        .header(header::IF_NONE_MATCH, TAG)
        .header(header::ORIGIN, "http://evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(r.headers()[header::ETAG], TAG);
    assert!(r.bytes().await.unwrap().is_empty());
    // The browser's Origin is never forwarded (Spokes would refuse it).
    assert_eq!(env.log.lock().unwrap().origins, 0);
}

#[tokio::test]
async fn node_detail() {
    let env = start().await;
    let (status, v) = env.json("/api/servers/New/nodes/SPOKE-3").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["node"]["notes"], "the plan");
    assert_eq!(env.seen(), vec!["/api/nodes/3?include_closed=false"]);

    let (status, v) = env.json("/api/servers/New/nodes/99").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(v["code"], "not_found");
    assert!(v["error"].as_str().unwrap().contains("SPOKE-99"), "{v}");

    let (status, v) = env.json("/api/servers/New/tree?root=404").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(v["code"], "not_found");
}

#[tokio::test]
async fn unknown_server_is_refused_without_any_upstream_call() {
    let env = start().await;
    for path in [
        "/api/servers/Nope/tree",
        "/api/servers/Nope/nodes/3",
        "/api/servers/http:%2F%2F127.0.0.1:1%2F/tree",
    ] {
        let (status, v) = env.json(path).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(v["code"], "unknown_server", "{path}");
    }
    assert!(env.seen().is_empty());
}

#[tokio::test]
async fn unreachable_upstream() {
    let env = start().await;
    let (status, v) = env.json("/api/servers/Dead/tree").await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(v["code"], "unreachable");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("'Dead' is unreachable"),
        "{v}"
    );
    let (_, v) = env.json("/api/servers/Dead/nodes/1").await;
    assert_eq!(v["code"], "unreachable");
}

#[tokio::test]
async fn too_old_upstream() {
    let env = start().await;
    for path in ["/api/servers/Old/tree", "/api/servers/Old/nodes/3"] {
        let (status, v) = env.json(path).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY, "{path}");
        assert_eq!(v["code"], "too_old");
        assert_eq!(
            v["error"],
            "this Spokes server is older than 0.2.0 and has no read API"
        );
    }
}

#[tokio::test]
async fn bad_parameters_never_reach_upstream() {
    let env = start().await;
    for path in [
        "/api/servers/New/tree?depth=11",
        "/api/servers/New/tree?depth=-1",
        "/api/servers/New/tree?depth=two",
        "/api/servers/New/tree?root=0",
        "/api/servers/New/tree?root=abc",
        "/api/servers/New/tree?root=1%26depth%3D10",
        "/api/servers/New/tree?root=1&root=2",
        "/api/servers/New/tree?include_closed=maybe",
        "/api/servers/New/tree?url=http://evil.example",
        "/api/servers/New/nodes/x",
        "/api/servers/New/nodes/0",
        "/api/servers/New/nodes/3?depth=1",
        "/api/servers?x=1",
    ] {
        let (status, v) = env.json(path).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}: {v}");
        assert_eq!(v["code"], "bad_request", "{path}");
    }
    assert!(env.seen().is_empty(), "{:?}", env.seen());

    let r = env
        .http
        .post(format!("{}/api/servers/New/tree", env.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::METHOD_NOT_ALLOWED);
    let (status, v) = env.json("/api/nothing").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(v["code"], "not_found");
}
