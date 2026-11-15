//! Configuration, from environment variables only.
//!
//! - `SPOKES_VIEW_SERVERS` (required): the Spokes servers the page may show, as
//!   `Name=URL` pairs separated by commas, e.g.
//!   `Home=http://192.168.5.100:10050,Dev=http://127.0.0.1:8787`. The browser only ever
//!   sends a name; the URLs never leave the backend.
//! - `SPOKES_VIEW_BIND`: listen address, default `127.0.0.1:8788`.
//! - `SPOKES_VIEW_LOG`: log level (read in `main.rs`).

use std::net::SocketAddr;

use reqwest::Url;

/// Default listen address (the image sets `0.0.0.0:8788`).
pub const DEFAULT_BIND: &str = "127.0.0.1:8788";

/// Longest server name accepted.
pub const MAX_NAME_LEN: usize = 40;

/// One Spokes server the page can show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Server {
    /// The name shown in the picker and sent by the browser.
    pub name: String,
    /// Base URL without a trailing slash, e.g. `http://127.0.0.1:8787` or
    /// `https://spokes.lan/prefix`.
    pub base: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub servers: Vec<Server>,
}

impl Config {
    /// Reads the process environment.
    pub fn from_env() -> anyhow::Result<Config> {
        Self::from_vars(|k| std::env::var(k).ok())
    }

    /// Reads configuration through `get` (the environment, or a map in tests).
    pub fn from_vars(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Config> {
        let bind = bind_from(get("SPOKES_VIEW_BIND"))?;
        let servers = match get("SPOKES_VIEW_SERVERS") {
            Some(v) if !v.trim().is_empty() => parse_servers(&v)
                .map_err(|e| anyhow::anyhow!("SPOKES_VIEW_SERVERS is invalid: {e}"))?,
            _ => anyhow::bail!(
                "SPOKES_VIEW_SERVERS is not set; list the Spokes servers to show, e.g. \
                 SPOKES_VIEW_SERVERS=\"Home=http://192.168.5.100:10050,Dev=http://127.0.0.1:8787\""
            ),
        };
        Ok(Config { bind, servers })
    }
}

/// The listen address from `SPOKES_VIEW_BIND` (or the default).
pub fn bind_from(value: Option<String>) -> anyhow::Result<SocketAddr> {
    let raw = value
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BIND.to_string());
    raw.trim().parse().map_err(|_| {
        anyhow::anyhow!("SPOKES_VIEW_BIND '{raw}' is not an address like 127.0.0.1:8788")
    })
}

/// Parses `Name=URL,Name=URL`. Names must be unique (ignoring case).
pub fn parse_servers(value: &str) -> Result<Vec<Server>, String> {
    let mut out: Vec<Server> = Vec::new();
    for (i, entry) in value.split(',').enumerate() {
        let n = i + 1;
        let entry = entry.trim();
        if entry.is_empty() {
            return Err(format!(
                "entry {n} is empty (check for a stray or doubled comma)"
            ));
        }
        let Some((name, url)) = entry.split_once('=') else {
            return Err(format!(
                "entry {n} ('{entry}') has no '='; write it as Name=http://host:port"
            ));
        };
        let name = name.trim();
        check_name(name).map_err(|e| format!("entry {n}: {e}"))?;
        if out.iter().any(|s| s.name.eq_ignore_ascii_case(name)) {
            return Err(format!("entry {n}: the name '{name}' is used twice"));
        }
        let base = check_url(url.trim()).map_err(|e| format!("entry {n} ('{name}'): {e}"))?;
        out.push(Server {
            name: name.to_string(),
            base,
        });
    }
    Ok(out)
}

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("the name before '=' is empty".into());
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "the name '{name}' is longer than {MAX_NAME_LEN} characters"
        ));
    }
    let first_ok = name
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric());
    let rest_ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'));
    if !first_ok || !rest_ok {
        return Err(format!(
            "the name '{name}' may only use letters, digits, spaces, '-', '_' and '.', \
             and must start with a letter or digit"
        ));
    }
    Ok(())
}

/// A base URL: http or https, a host, no user info, query or fragment.
/// Returned without a trailing slash.
fn check_url(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw).map_err(|e| format!("'{raw}' is not a URL ({e})"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("'{raw}' must start with http:// or https://"));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(format!("'{raw}' has no host"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("the URL must not carry a user name or password".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(format!("'{raw}' must not have a query (?) or fragment (#)"));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn vars(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn parses_a_list_in_order() {
        let s = parse_servers(
            "Home=http://192.168.5.100:10050, Dev = http://127.0.0.1:8787/ ,Big one=https://spokes.lan/prefix/",
        )
        .unwrap();
        assert_eq!(
            s,
            vec![
                Server {
                    name: "Home".into(),
                    base: "http://192.168.5.100:10050".into()
                },
                Server {
                    name: "Dev".into(),
                    base: "http://127.0.0.1:8787".into()
                },
                Server {
                    name: "Big one".into(),
                    base: "https://spokes.lan/prefix".into()
                },
            ]
        );
    }

    #[test]
    fn a_single_server_is_fine() {
        let s = parse_servers("Dev=http://localhost:8787").unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].base, "http://localhost:8787");
    }

    #[test]
    fn refuses_malformed_lists() {
        let err = |v: &str| parse_servers(v).unwrap_err();
        assert!(err("Home").contains("no '='"));
        assert!(err("Home=http://a:1,,Dev=http://b:2").contains("entry 2 is empty"));
        assert!(err("Home=http://a:1,").contains("entry 2 is empty"));
        assert!(err("=http://a:1").contains("empty"));
        assert!(err("Home=http://a:1,home=http://b:2").contains("used twice"));
        assert!(err("Ho/me=http://a:1").contains("may only use"));
        assert!(err("-x=http://a:1").contains("must start"));
        assert!(err(&format!("{}=http://a:1", "x".repeat(41))).contains("longer than"));
        assert!(err("Home=ftp://a:1").contains("http:// or https://"));
        assert!(err("Home=not a url").contains("is not a URL"));
        assert!(err("Home=http://user:pw@a:1").contains("user name or password"));
        assert!(err("Home=http://a:1/?x=1").contains("query"));
        assert!(err("Home=http://a:1/#f").contains("fragment"));
        assert!(err("Home=").contains("is not a URL"));
    }

    #[test]
    fn config_requires_servers_and_checks_bind() {
        let e = Config::from_vars(vars(&[])).unwrap_err().to_string();
        assert!(e.contains("SPOKES_VIEW_SERVERS is not set"), "{e}");
        let e = Config::from_vars(vars(&[("SPOKES_VIEW_SERVERS", "  ")]))
            .unwrap_err()
            .to_string();
        assert!(e.contains("not set"), "{e}");
        let e = Config::from_vars(vars(&[("SPOKES_VIEW_SERVERS", "Home")]))
            .unwrap_err()
            .to_string();
        assert!(
            e.starts_with("SPOKES_VIEW_SERVERS is invalid: entry 1"),
            "{e}"
        );

        let c = Config::from_vars(vars(&[("SPOKES_VIEW_SERVERS", "A=http://x:1")])).unwrap();
        assert_eq!(c.bind.to_string(), DEFAULT_BIND);
        let c = Config::from_vars(vars(&[
            ("SPOKES_VIEW_SERVERS", "A=http://x:1"),
            ("SPOKES_VIEW_BIND", "0.0.0.0:9000"),
        ]))
        .unwrap();
        assert_eq!(c.bind.to_string(), "0.0.0.0:9000");
        let e = Config::from_vars(vars(&[
            ("SPOKES_VIEW_SERVERS", "A=http://x:1"),
            ("SPOKES_VIEW_BIND", "localhost"),
        ]))
        .unwrap_err()
        .to_string();
        assert!(e.contains("SPOKES_VIEW_BIND"), "{e}");
    }
}
