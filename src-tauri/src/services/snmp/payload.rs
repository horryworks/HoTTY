//! Event payloads emitted to the renderer.
//!
//! Every `Option` carries `skip_serializing_if` because these payloads are large
//! by nature: a 48-port switch produces ~24 KB per poll and a 200-port chassis
//! ~100 KB. On a real device most rows have no alias and down ports have no
//! rates at all, so omitting nulls removes a serious fraction of the bytes. The
//! TypeScript side declares the same fields optional, so this is transparent.
//!
//! Snapshots are always complete — never deltas. Events are broadcast with no
//! delivery guarantee, so a delta protocol would let one dropped event corrupt
//! the table permanently.

use serde::Serialize;

/// One interface's row in the live table.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IfRow {
    pub if_index: u32,
    /// ifName — the short form ("Gi0/1"). Absent on agents without ifXTable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// ifDescr — the long form. Always available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descr: Option<String>,
    /// ifAlias — the operator's description text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    /// Raw IF-MIB enum values; the renderer maps them to labels so the strings
    /// stay translatable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin_status: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oper_status: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_mbps: Option<u32>,

    // Rates — null until the second poll, and on any counter discontinuity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bps_in: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bps_out: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pps_in: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pps_out: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub util_in_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub util_out_pct: Option<f64>,

    // Cumulative counters, straight from the device.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_errors: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_errors: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_discards: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_discards: Option<u64>,

    // Per-poll increments — what actually tells you something is wrong now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_errors_delta: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_errors_delta: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_discards_delta: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_discards_delta: Option<u64>,

    /// The counters restarted between this poll and the last one.
    pub discontinuity: bool,
}

/// One poll cycle's complete snapshot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnmpDataPayload {
    pub pane_id: String,
    pub timestamp: String,
    /// `"ok"` | `"degraded"` | `"error"`.
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sys_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sys_uptime_secs: Option<u64>,
    /// `"hc"` (64-bit ifXTable) or `"legacy"` (32-bit ifTable fallback).
    pub counter_width: &'static str,
    /// How long this cycle actually took — the field that tells you when a
    /// chassis has outgrown the chosen interval.
    pub poll_ms: u64,
    /// The interval currently in effect, after clamping and failure backoff.
    pub interval_ms: u64,
    /// Set when the rows are carried over from an earlier successful poll.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_for_ms: Option<u64>,
    pub interfaces: Vec<IfRow>,
}

/// Lifecycle transitions — rare compared to data events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnmpStatusPayload {
    pub pane_id: String,
    /// `"connecting"` | `"running"` | `"stopped"` | `"error"`.
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub timestamp: String,
}

/// One entry in the discovery listing.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnmpInterfaceInfo {
    pub if_index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_mbps: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oper_status: Option<u8>,
}

/// Result of the one-shot "list interfaces" / connection test.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnmpDiscovery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sys_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sys_descr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sys_uptime_secs: Option<u64>,
    pub counter_width: &'static str,
    pub interfaces: Vec<SnmpInterfaceInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> IfRow {
        IfRow {
            if_index: 7,
            name: Some("Gi0/7".into()),
            descr: Some("GigabitEthernet0/7".into()),
            alias: None,
            admin_status: Some(1),
            oper_status: Some(1),
            speed_mbps: Some(1000),
            bps_in: Some(1_000_000.0),
            bps_out: Some(2_000_000.0),
            pps_in: Some(120.0),
            pps_out: Some(240.0),
            util_in_pct: Some(0.1),
            util_out_pct: Some(0.2),
            in_errors: Some(3),
            out_errors: Some(0),
            in_discards: Some(0),
            out_discards: Some(0),
            in_errors_delta: Some(1),
            out_errors_delta: Some(0),
            in_discards_delta: Some(0),
            out_discards_delta: Some(0),
            discontinuity: false,
        }
    }

    #[test]
    fn if_row_serializes_camel_case() {
        let json = serde_json::to_value(sample_row()).unwrap();
        assert_eq!(json["ifIndex"], 7);
        assert_eq!(json["name"], "Gi0/7");
        assert_eq!(json["operStatus"], 1);
        assert_eq!(json["speedMbps"], 1000);
        assert_eq!(json["bpsIn"], 1_000_000.0);
        assert_eq!(json["utilOutPct"], 0.2);
        assert_eq!(json["inErrorsDelta"], 1);
        assert_eq!(json["discontinuity"], false);
    }

    #[test]
    fn if_row_omits_none_fields() {
        let json = serde_json::to_value(sample_row()).unwrap();
        assert!(
            json.get("alias").is_none(),
            "None fields must be omitted, not serialized as null"
        );
    }

    #[test]
    fn if_row_keeps_discontinuity_even_when_false() {
        let json = serde_json::to_value(sample_row()).unwrap();
        assert!(json.get("discontinuity").is_some());
    }

    #[test]
    fn data_payload_serializes() {
        let payload = SnmpDataPayload {
            pane_id: "if-abc".into(),
            timestamp: "2026-07-27 10:00:00.000".into(),
            status: "ok",
            error: None,
            sys_name: Some("switch-01".into()),
            sys_uptime_secs: Some(1234),
            counter_width: "hc",
            poll_ms: 812,
            interval_ms: 10_000,
            stale_for_ms: None,
            interfaces: vec![sample_row()],
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["paneId"], "if-abc");
        assert_eq!(json["counterWidth"], "hc");
        assert_eq!(json["pollMs"], 812);
        assert_eq!(json["intervalMs"], 10_000);
        assert_eq!(json["sysName"], "switch-01");
        assert_eq!(json["interfaces"][0]["ifIndex"], 7);
        assert!(json.get("staleForMs").is_none());
        assert!(json.get("error").is_none());
    }

    #[test]
    fn status_payload_serializes() {
        let payload = SnmpStatusPayload {
            pane_id: "if-abc".into(),
            state: "connecting",
            message: None,
            timestamp: "2026-07-27 10:00:00.000".into(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["paneId"], "if-abc");
        assert_eq!(json["state"], "connecting");
    }

    #[test]
    fn discovery_serializes() {
        let discovery = SnmpDiscovery {
            sys_name: Some("switch-01".into()),
            sys_descr: Some("Example NOS 1.0".into()),
            sys_uptime_secs: Some(60),
            counter_width: "hc",
            interfaces: vec![SnmpInterfaceInfo {
                if_index: 1,
                name: Some("Gi0/1".into()),
                descr: Some("GigabitEthernet0/1".into()),
                alias: None,
                speed_mbps: Some(1000),
                oper_status: Some(1),
            }],
        };
        let json = serde_json::to_value(&discovery).unwrap();
        assert_eq!(json["sysName"], "switch-01");
        assert_eq!(json["counterWidth"], "hc");
        assert_eq!(json["interfaces"][0]["speedMbps"], 1000);
        assert!(json["interfaces"][0].get("alias").is_none());
    }
}
