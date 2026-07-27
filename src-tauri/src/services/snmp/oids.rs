//! IF-MIB column definitions and OID-instance helpers.
//!
//! Everything here is pure arithmetic over OID arc slices — no sockets, no
//! `snmp2` types — so the walk's trickiest logic (deciding when a column subtree
//! has ended) is unit-testable without a device.

/// Which IF-MIB column a walked value came from.
///
/// The poller walks several columns concurrently in one GETBULK, so every value
/// has to carry its provenance back out of the walk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ColumnId {
    // Counters — polled every cycle.
    InOctets,
    OutOctets,
    InUcastPkts,
    InMulticastPkts,
    InBroadcastPkts,
    OutUcastPkts,
    OutMulticastPkts,
    OutBroadcastPkts,
    InErrors,
    OutErrors,
    InDiscards,
    OutDiscards,
    AdminStatus,
    OperStatus,
    CounterDiscontinuityTime,
    // Descriptive — polled on the first cycle and every `SLOW_EVERY_N` after.
    IfName,
    IfAlias,
    IfDescr,
    HighSpeed,
}

/// One walkable table column.
pub struct ColumnDef {
    pub id: ColumnId,
    /// Base OID arcs, WITHOUT the trailing instance (ifIndex) sub-identifier.
    pub arcs: &'static [u64],
}

// ifTable  = 1.3.6.1.2.1.2.2.1
// ifXTable = 1.3.6.1.2.1.31.1.1.1

/// 64-bit counter columns from ifXTable (RFC 2863). Preferred whenever the agent
/// implements them.
pub const HC_COUNTER_COLUMNS: &[ColumnDef] = &[
    ColumnDef {
        id: ColumnId::InOctets,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6],
    },
    ColumnDef {
        id: ColumnId::OutOctets,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 10],
    },
    ColumnDef {
        id: ColumnId::InUcastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 7],
    },
    ColumnDef {
        id: ColumnId::InMulticastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 8],
    },
    ColumnDef {
        id: ColumnId::InBroadcastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 9],
    },
    ColumnDef {
        id: ColumnId::OutUcastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 11],
    },
    ColumnDef {
        id: ColumnId::OutMulticastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 12],
    },
    ColumnDef {
        id: ColumnId::OutBroadcastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 13],
    },
];

/// 32-bit fallback for agents without ifXTable. `InMulticastPkts` carries
/// ifInNUcastPkts (the deprecated combined multicast+broadcast counter) and the
/// broadcast slots are simply absent, which the row assembler treats as 0.
pub const LEGACY_COUNTER_COLUMNS: &[ColumnDef] = &[
    ColumnDef {
        id: ColumnId::InOctets,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 10],
    },
    ColumnDef {
        id: ColumnId::OutOctets,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 16],
    },
    ColumnDef {
        id: ColumnId::InUcastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 11],
    },
    ColumnDef {
        id: ColumnId::InMulticastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 12],
    },
    ColumnDef {
        id: ColumnId::OutUcastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 17],
    },
    ColumnDef {
        id: ColumnId::OutMulticastPkts,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 18],
    },
];

/// Error/discard/status columns — identical in both counter modes (ifTable only),
/// except `CounterDiscontinuityTime` which is ifXTable-only and is therefore
/// omitted from the legacy set.
pub const STATUS_COLUMNS: &[ColumnDef] = &[
    ColumnDef {
        id: ColumnId::InErrors,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 14],
    },
    ColumnDef {
        id: ColumnId::OutErrors,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 20],
    },
    ColumnDef {
        id: ColumnId::InDiscards,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 13],
    },
    ColumnDef {
        id: ColumnId::OutDiscards,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 19],
    },
    ColumnDef {
        id: ColumnId::AdminStatus,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 7],
    },
    ColumnDef {
        id: ColumnId::OperStatus,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 8],
    },
];

/// ifCounterDiscontinuityTime — the RFC-correct "these counters were reset"
/// signal. ifXTable only, so it is walked only in HC mode.
pub const DISCONTINUITY_COLUMN: &[ColumnDef] = &[ColumnDef {
    id: ColumnId::CounterDiscontinuityTime,
    arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 19],
}];

/// Descriptive columns, refreshed infrequently.
pub const SLOW_COLUMNS: &[ColumnDef] = &[
    ColumnDef {
        id: ColumnId::IfName,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 1],
    },
    ColumnDef {
        id: ColumnId::IfAlias,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 18],
    },
    ColumnDef {
        id: ColumnId::IfDescr,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 2],
    },
    ColumnDef {
        id: ColumnId::HighSpeed,
        arcs: &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 15],
    },
];

/// Legacy descriptive set: no ifName/ifAlias (ifXTable), and speed comes from
/// ifSpeed in bit/s rather than ifHighSpeed in Mbit/s.
pub const LEGACY_SLOW_COLUMNS: &[ColumnDef] = &[
    ColumnDef {
        id: ColumnId::IfDescr,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 2],
    },
    ColumnDef {
        id: ColumnId::HighSpeed,
        arcs: &[1, 3, 6, 1, 2, 1, 2, 2, 1, 5],
    },
];

/// `sysUpTime.0` — a decrease means the device rebooted and every counter on it
/// restarted.
pub const SYS_UPTIME_OID: &[u64] = &[1, 3, 6, 1, 2, 1, 1, 3, 0];
/// `sysName.0`
pub const SYS_NAME_OID: &[u64] = &[1, 3, 6, 1, 2, 1, 1, 5, 0];
/// `sysDescr.0`
pub const SYS_DESCR_OID: &[u64] = &[1, 3, 6, 1, 2, 1, 1, 1, 0];

/// Extract the ifIndex instance from a walked OID, or `None` if the OID has left
/// the column subtree.
///
/// `None` is the walk's stop condition, so the check is deliberately strict:
/// the OID must be exactly `column` plus **one** more arc, and that arc must be a
/// valid `InterfaceIndex` (1..=2^31-1 per RFC 2863). An OID that is merely
/// prefixed by `column` but goes deeper belongs to a nested table, not to us.
pub fn if_index_from(oid: &[u64], column: &[u64]) -> Option<u32> {
    if oid.len() != column.len() + 1 {
        return None;
    }
    if &oid[..column.len()] != column {
        return None;
    }
    let index = u32::try_from(oid[column.len()]).ok()?;
    if index == 0 || index > i32::MAX as u32 {
        return None;
    }
    Some(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    const IF_HC_IN_OCTETS: &[u64] = &[1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6];

    #[test]
    fn if_index_from_extracts_single_arc_index() {
        let oid = [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, 42];
        assert_eq!(if_index_from(&oid, IF_HC_IN_OCTETS), Some(42));
    }

    #[test]
    fn if_index_from_rejects_sibling_column() {
        // ifHCInUcastPkts.3 walked while asking for ifHCInOctets — the walk has
        // run off the end of our column and must stop.
        let oid = [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 7, 3];
        assert_eq!(if_index_from(&oid, IF_HC_IN_OCTETS), None);
    }

    #[test]
    fn if_index_from_rejects_two_arc_instance() {
        let oid = [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, 42, 1];
        assert_eq!(if_index_from(&oid, IF_HC_IN_OCTETS), None);
    }

    #[test]
    fn if_index_from_rejects_bare_column() {
        assert_eq!(if_index_from(IF_HC_IN_OCTETS, IF_HC_IN_OCTETS), None);
    }

    #[test]
    fn if_index_from_rejects_shorter_oid() {
        let oid = [1, 3, 6, 1, 2, 1, 31];
        assert_eq!(if_index_from(&oid, IF_HC_IN_OCTETS), None);
    }

    #[test]
    fn if_index_from_rejects_index_zero() {
        let oid = [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, 0];
        assert_eq!(if_index_from(&oid, IF_HC_IN_OCTETS), None);
    }

    #[test]
    fn if_index_from_rejects_index_over_i32_max() {
        let oid = [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, i32::MAX as u64 + 1];
        assert_eq!(if_index_from(&oid, IF_HC_IN_OCTETS), None);
        let oid_max = [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, i32::MAX as u64];
        assert_eq!(
            if_index_from(&oid_max, IF_HC_IN_OCTETS),
            Some(i32::MAX as u32)
        );
    }

    #[test]
    fn hc_and_legacy_column_sets_are_disjoint() {
        for hc in HC_COUNTER_COLUMNS {
            for legacy in LEGACY_COUNTER_COLUMNS {
                assert_ne!(hc.arcs, legacy.arcs, "{:?} shares an OID", hc.id);
            }
        }
    }

    #[test]
    fn every_column_oid_is_under_mib_2_interfaces() {
        // 1.3.6.1.2.1.2 (interfaces) or 1.3.6.1.2.1.31 (ifMIB) — a typo in an arc
        // table is otherwise invisible until a device silently returns nothing.
        let all = HC_COUNTER_COLUMNS
            .iter()
            .chain(LEGACY_COUNTER_COLUMNS)
            .chain(STATUS_COLUMNS)
            .chain(DISCONTINUITY_COLUMN)
            .chain(SLOW_COLUMNS)
            .chain(LEGACY_SLOW_COLUMNS);
        for col in all {
            assert_eq!(&col.arcs[..6], &[1, 3, 6, 1, 2, 1], "{:?}", col.id);
            assert!(
                col.arcs[6] == 2 || col.arcs[6] == 31,
                "{:?} is not in interfaces/ifMIB",
                col.id
            );
        }
    }

    #[test]
    fn column_ids_are_unique_within_each_set() {
        for set in [
            HC_COUNTER_COLUMNS,
            LEGACY_COUNTER_COLUMNS,
            STATUS_COLUMNS,
            SLOW_COLUMNS,
            LEGACY_SLOW_COLUMNS,
        ] {
            let mut seen = Vec::new();
            for col in set {
                assert!(!seen.contains(&col.id), "duplicate {:?}", col.id);
                seen.push(col.id);
            }
        }
    }
}
