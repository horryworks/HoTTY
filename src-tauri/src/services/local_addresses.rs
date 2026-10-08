//! This PC's own IPv4 addresses, for the File Server pane.
//!
//! A device pulling a file over TFTP/SFTP needs the PC's address typed into its
//! own command (`copy tftp://<pc>/file flash:`). Users had to go and run
//! `ipconfig` for it; the pane now shows it, with the adapter name so a PC on
//! both wired and Wi-Fi can tell which address faces the device.

use std::net::{Ipv4Addr, UdpSocket};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAddress {
    /// The adapter's friendly name ("Ethernet", "Wi-Fi").
    pub name: String,
    pub address: String,
}

/// Every usable IPv4 address on an adapter that is up, the one holding the
/// default route first. Loopback and link-local (169.254/16) addresses are left
/// out: no device on the LAN can reach the PC through them.
pub fn local_ipv4_addresses() -> Vec<LocalAddress> {
    let mut list = adapter_addresses();
    if let Some(primary) = primary_ipv4() {
        let primary = primary.to_string();
        if let Some(i) = list.iter().position(|a| a.address == primary) {
            let first = list.remove(i);
            list.insert(0, first);
        } else if list.is_empty() {
            list.push(LocalAddress {
                name: String::new(),
                address: primary,
            });
        }
    }
    list
}

/// Whether an address is one a device on the LAN could use to reach this PC.
fn is_reachable(ip: Ipv4Addr) -> bool {
    !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified() && !ip.is_broadcast()
}

/// The address the OS would send from towards the default route. Connecting a
/// UDP socket sends nothing; it only makes the OS pick a route. The target is a
/// documentation address (TEST-NET-1), so no real host is involved.
fn primary_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if is_reachable(ip) => Some(ip),
        _ => None,
    }
}

#[cfg(windows)]
fn adapter_addresses() -> Vec<LocalAddress> {
    use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
        GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    // IF_TYPE_SOFTWARE_LOOPBACK from ipifcons.h.
    const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;

    // The adapter list is variable-length; ask, grow the buffer if told to, ask
    // again. A u64 buffer keeps the structures 8-byte aligned.
    let mut size: u32 = 16 * 1024;
    let mut buf: Vec<u64> = Vec::new();
    let mut ok = false;
    for _ in 0..3 {
        buf = vec![0u64; (size as usize).div_ceil(8)];
        // SAFETY: `buf` is a writable allocation of at least `size` bytes,
        // suitably aligned, and `size` tells the API its length. The API writes
        // only within it and reports the size it needs on overflow.
        let ret = unsafe {
            GetAdaptersAddresses(
                AF_INET.0 as u32,
                flags,
                None,
                Some(buf.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>()),
                &mut size,
            )
        };
        if ret == ERROR_SUCCESS.0 {
            ok = true;
            break;
        }
        if ret != ERROR_BUFFER_OVERFLOW.0 {
            log::debug!("file-server: GetAdaptersAddresses failed: {ret}");
            return Vec::new();
        }
    }
    if !ok {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut adapter = buf.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
    while !adapter.is_null() {
        // SAFETY: every pointer walked here (the adapter list, its unicast
        // list, each sockaddr, the friendly-name string) points into `buf`,
        // which the successful call above filled and which outlives this loop.
        let a = unsafe { &*adapter };
        if a.OperStatus == IfOperStatusUp && a.IfType != IF_TYPE_SOFTWARE_LOOPBACK {
            let name = unsafe { a.FriendlyName.to_string() }.unwrap_or_default();
            let mut unicast = a.FirstUnicastAddress;
            while !unicast.is_null() {
                let u = unsafe { &*unicast };
                let sa = u.Address.lpSockaddr;
                if !sa.is_null() && unsafe { (*sa).sa_family } == AF_INET {
                    let sin = unsafe { &*sa.cast::<SOCKADDR_IN>() };
                    let ip = Ipv4Addr::from(u32::from_be(unsafe { sin.sin_addr.S_un.S_addr }));
                    if is_reachable(ip) {
                        out.push(LocalAddress {
                            name: name.clone(),
                            address: ip.to_string(),
                        });
                    }
                }
                unicast = u.Next;
            }
        }
        adapter = a.Next;
    }
    out
}

#[cfg(not(windows))]
fn adapter_addresses() -> Vec<LocalAddress> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_out_addresses_a_device_cannot_reach() {
        assert!(!is_reachable(Ipv4Addr::LOCALHOST));
        assert!(!is_reachable(Ipv4Addr::new(169, 254, 10, 1)));
        assert!(!is_reachable(Ipv4Addr::UNSPECIFIED));
        assert!(is_reachable(Ipv4Addr::new(192, 0, 2, 15)));
        assert!(is_reachable(Ipv4Addr::new(10, 0, 0, 1)));
    }

    #[test]
    fn lists_no_loopback_or_link_local_address() {
        for a in local_ipv4_addresses() {
            let ip: Ipv4Addr = a.address.parse().expect("an IPv4 address");
            assert!(is_reachable(ip), "{ip} should have been left out");
        }
    }

    #[test]
    fn serializes_camel_case() {
        let json = serde_json::to_value(LocalAddress {
            name: "Ethernet".into(),
            address: "192.0.2.15".into(),
        })
        .unwrap();
        assert_eq!(json["name"], "Ethernet");
        assert_eq!(json["address"], "192.0.2.15");
    }
}
