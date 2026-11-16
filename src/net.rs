//! `net.*` bridge commands. `net.ping` measures the player's real round trip to Krunker's region servers: timed TCP
//! connects to port 443 of the lobby hosts the matchmaker's ping list names (`lobby-….frankfurt.krunker.io`). A TCP
//! handshake is one round trip, without the TLS and HTTP work that Krunker's own `/ping` fetch adds on top.

use serde_json::{json, Map, Value};
use std::{
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    thread,
    time::{Duration, Instant},
};

const MAX_HOSTS: usize = 32;
const TIMEOUT: Duration = Duration::from_millis(1500);

pub fn command(cmd: &str, request: &Value) -> Result<Value, String> {
    match cmd {
        "net.ping" => ping(request),
        _ => Err(format!("unknown command {cmd}")),
    }
}

/// `{hosts: ["lobby-x.frankfurt.krunker.io", ...], samples?: 1..8}` → `{host: {min, median, ok} | null}` in ms.
fn ping(request: &Value) -> Result<Value, String> {
    let hosts = request["hosts"].as_array().ok_or("hosts must be a list")?;
    if hosts.is_empty() || hosts.len() > MAX_HOSTS {
        return Err(format!("1 to {MAX_HOSTS} hosts"));
    }
    let hosts: Vec<&str> = hosts.iter().map(|h| h.as_str().filter(|h| krunker_host(h)).ok_or("only *.krunker.io hosts")).collect::<Result<_, _>>()?;
    let samples = request["samples"].as_u64().unwrap_or(4).clamp(1, 8) as usize;
    // One thread per host, so a far region doesn't hold up the rest; each host's connects run one after another.
    let results: Vec<Value> = thread::scope(|scope| {
        let handles: Vec<_> = hosts.iter().map(|host| scope.spawn(move || resolve(host).map(|addr| measure(addr, samples)))).collect();
        handles.into_iter().map(|h| h.join().ok().flatten().unwrap_or(Value::Null)).collect()
    });
    Ok(Value::Object(hosts.iter().map(|h| h.to_string()).zip(results).collect::<Map<_, _>>()))
}

/// A DNS name under krunker.io: lowercase letters, digits and hyphens. Nothing else may be pinged.
fn krunker_host(host: &str) -> bool {
    host.len() <= 253
        && host.ends_with(".krunker.io")
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// DNS first, so its time never counts; IPv4 preferred (Krunker's lobbies have no IPv6).
fn resolve(host: &str) -> Option<SocketAddr> {
    let addrs: Vec<SocketAddr> = (host, 443).to_socket_addrs().ok()?.collect();
    addrs.iter().find(|a| a.is_ipv4()).or(addrs.first()).copied()
}

/// `samples` timed connects; the first one also warms the route, so the minimum is the honest number.
fn measure(addr: SocketAddr, samples: usize) -> Value {
    let mut times: Vec<f64> = (0..samples)
        .filter_map(|_| {
            let start = Instant::now();
            TcpStream::connect_timeout(&addr, TIMEOUT).ok().map(|_| start.elapsed().as_secs_f64() * 1000.0)
        })
        .collect();
    if times.is_empty() {
        return Value::Null;
    }
    times.sort_by(f64::total_cmp);
    let round = |ms: f64| (ms * 10.0).round() / 10.0;
    json!({ "min": round(times[0]), "median": round(times[times.len() / 2]), "ok": times.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_krunker_hosts() {
        for good in ["lobby-grl7l-pfnb8.frankfurt.krunker.io", "a.krunker.io", "lobby-raid-new-kvrhl-pndvm.saopaulo.krunker.io"] {
            assert!(krunker_host(good), "{good}");
        }
        for bad in [
            "krunker.io",
            "evil.com",
            "krunker.io.evil.com",
            "evilkrunker.io",
            "x.krunker.io:3000",
            "x..krunker.io",
            "-x.krunker.io",
            "X.krunker.io",
            "127.0.0.1",
            "x.krunker.io/path",
            "x krunker.io",
        ] {
            assert!(!krunker_host(bad), "{bad}");
        }
    }

    #[test]
    fn ping_validates_before_connecting() {
        assert!(ping(&json!({})).is_err());
        assert!(ping(&json!({ "hosts": [] })).is_err());
        assert!(ping(&json!({ "hosts": ["localhost"] })).is_err());
        assert!(ping(&json!({ "hosts": ["a.krunker.io", 5] })).is_err());
        assert!(ping(&json!({ "hosts": vec!["a.krunker.io"; MAX_HOSTS + 1] })).is_err());
    }

    #[test]
    fn measures_a_listening_port_and_reports_a_closed_one() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let open = measure(listener.local_addr().unwrap(), 3);
        assert_eq!(open["ok"], 3);
        assert!(open["min"].as_f64().unwrap() <= open["median"].as_f64().unwrap());
        let closed = listener.local_addr().unwrap();
        drop(listener);
        assert_eq!(measure(closed, 2), Value::Null);
    }
}
