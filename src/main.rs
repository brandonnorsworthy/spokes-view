use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::ExitCode;
use std::time::Duration;

use spokes_view::config::{self, Config};
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() -> ExitCode {
    // `spokes-view healthcheck` probes /health on the configured port (for Docker
    // HEALTHCHECK, since the runtime image has no shell or curl).
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("healthcheck") => return healthcheck(),
        None => {}
        Some(_) => {
            eprintln!("usage: spokes-view [healthcheck]");
            return ExitCode::from(2);
        }
    }
    let level = std::env::var("SPOKES_VIEW_LOG")
        .ok()
        .and_then(|l| l.parse().ok())
        .unwrap_or(tracing::Level::INFO);
    // Keep the HTTP client's internals quiet unless asked for trace.
    let filter = Targets::new()
        .with_default(level)
        .with_target("hyper_util", level.min(tracing::Level::INFO))
        .with_target("reqwest", level.min(tracing::Level::INFO));
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout())),
        )
        .with(filter)
        .init();

    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    let names: Vec<&str> = config.servers.iter().map(|s| s.name.as_str()).collect();
    tracing::info!(bind = %config.bind, servers = ?names, "spokes-view listening");
    spokes_view::serve(listener, &config, shutdown_signal()).await?;
    tracing::info!("spokes-view stopped");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
}

/// Exit 0 when /health on `SPOKES_VIEW_BIND` answers 200. Needs only the bind address.
fn healthcheck() -> ExitCode {
    let Ok(mut addr) = config::bind_from(std::env::var("SPOKES_VIEW_BIND").ok()) else {
        return ExitCode::FAILURE;
    };
    if addr.ip().is_unspecified() {
        addr = SocketAddr::from(([127, 0, 0, 1], addr.port()));
    }
    let probe = || -> std::io::Result<bool> {
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))?;
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        write!(
            stream,
            "GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"
        )?;
        let mut response = String::new();
        stream.read_to_string(&mut response)?;
        Ok(response.starts_with("HTTP/1.1 200"))
    };
    if probe().unwrap_or(false) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
