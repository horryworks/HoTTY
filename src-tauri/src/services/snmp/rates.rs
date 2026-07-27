//! Counter differencing and rate derivation.
//!
//! SNMP gives you monotonically increasing counters, not rates; everything the
//! pane shows is a difference between two polls divided by the measured elapsed
//! time. The subtle parts, and why they are written this way:
//!
//!   * **A backwards Counter32 is a wrap. A backwards Counter64 is a reset.**
//!     2^64 octets at 100 Gbps takes ~46 years, so a 64-bit counter going
//!     backwards is an agent restart or a `clear counters`, never arithmetic
//!     wrap-around. Wrap-correcting it would print an absurd number.
//!   * **Packet sub-counters are differenced first and summed second.** Summing
//!     ucast+mcast+bcast and then differencing loses the information needed to
//!     detect which sub-counter wrapped.
//!   * **Elapsed time is measured with `Instant`**, never the wall clock, so an
//!     NTP step cannot manufacture a traffic spike.

use std::collections::HashMap;
use std::time::Instant;

/// Below this, the two samples are too close together for the quotient to mean
/// anything; we skip the calculation and keep the older baseline.
pub const MIN_ELAPSED_MS: u64 = 250;

/// How far above line rate a computed bps may sit before we call it implausible.
/// 25% covers polling jitter and a slightly optimistic `ifHighSpeed`.
const MAX_PLAUSIBLE_FACTOR: f64 = 1.25;

/// Utilization is clamped here so one bad sample cannot render a table cell
/// 12 digits wide.
const MAX_UTIL_PCT: f64 = 1000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CounterWidth {
    /// ifXTable 64-bit counters.
    Bits64,
    /// ifTable 32-bit counters (agent has no ifXTable).
    Bits32,
}

impl CounterWidth {
    pub fn as_str(self) -> &'static str {
        match self {
            CounterWidth::Bits64 => "hc",
            CounterWidth::Bits32 => "legacy",
        }
    }
}

/// Difference two counter readings, correcting for wrap where wrap is possible.
///
/// Returns `None` when the counters are discontinuous — the caller must render
/// "—" for that metric, **not** zero (zero would read as "no traffic", which is
/// a different and wrong claim).
pub fn counter_delta(prev: u64, cur: u64, width: CounterWidth) -> Option<u64> {
    if cur >= prev {
        return Some(cur - prev);
    }
    match width {
        // Counter32 wraps at 2^32 — ~34 seconds of octets on a 1 Gbps link.
        CounterWidth::Bits32 => {
            if prev > u64::from(u32::MAX) {
                // Not actually a 32-bit reading; treat as a reset.
                return None;
            }
            Some((1u64 << 32) - prev + cur)
        }
        // Counter64 does not wrap in any human timescale.
        CounterWidth::Bits64 => None,
    }
}

/// A wrap correction that implies more than line rate is not a wrap — it is a
/// counter reset that happened to land on a lower value. Only meaningful for
/// octet counters, and only when the interface speed is known.
pub fn is_plausible_octet_delta(delta_octets: u64, dt_ms: u64, speed_mbps: Option<u32>) -> bool {
    let Some(speed_mbps) = speed_mbps.filter(|s| *s > 0) else {
        return true; // No bound to test against.
    };
    if dt_ms == 0 {
        return false;
    }
    let bits = delta_octets as f64 * 8.0;
    let capacity_bits = f64::from(speed_mbps) * 1_000_000.0 * (dt_ms as f64 / 1000.0);
    bits <= capacity_bits * MAX_PLAUSIBLE_FACTOR
}

pub fn bits_per_second(delta_octets: u64, dt_ms: u64) -> Option<f64> {
    if dt_ms == 0 {
        return None;
    }
    Some(delta_octets as f64 * 8.0 * 1000.0 / dt_ms as f64)
}

pub fn packets_per_second(delta_packets: u64, dt_ms: u64) -> Option<f64> {
    if dt_ms == 0 {
        return None;
    }
    Some(delta_packets as f64 * 1000.0 / dt_ms as f64)
}

/// Percentage of line rate. `None` when the speed is unknown — there is no
/// divide-by-zero path.
pub fn utilization_pct(bps: f64, speed_mbps: Option<u32>) -> Option<f64> {
    let speed_mbps = speed_mbps.filter(|s| *s > 0)?;
    let pct = bps / (f64::from(speed_mbps) * 1_000_000.0) * 100.0;
    Some(pct.min(MAX_UTIL_PCT))
}

/// One poll's raw readings for one interface.
#[derive(Debug, Clone, Default)]
pub struct IfCounters {
    pub in_octets: Option<u64>,
    pub out_octets: Option<u64>,
    pub in_ucast: Option<u64>,
    pub in_mcast: Option<u64>,
    pub in_bcast: Option<u64>,
    pub out_ucast: Option<u64>,
    pub out_mcast: Option<u64>,
    pub out_bcast: Option<u64>,
    pub in_errors: Option<u64>,
    pub out_errors: Option<u64>,
    pub in_discards: Option<u64>,
    pub out_discards: Option<u64>,
    /// ifCounterDiscontinuityTime, in TimeTicks. An increase means the agent
    /// reset this interface's counters.
    pub discontinuity_time: Option<u32>,
}

/// How long a completely static set of counters is treated as "the agent has not
/// refreshed yet" rather than "the link is idle".
///
/// Many embedded SNMP agents update their interface statistics on an internal
/// tick (5s and 10s are both common) instead of on demand. Polling faster than
/// that tick makes every other poll read the *same* counter value, so a naive
/// implementation alternates between 0 bps and double the real rate — both
/// wrong. Within this window we hold the last computed rate and keep the older
/// baseline, so when the counter does move the rate is divided by the interval
/// it actually covers. Past it, a counter that has not moved really does mean no
/// traffic.
pub const STALE_HOLD_MS: u64 = 30_000;

#[derive(Debug, Clone)]
struct IfSample {
    at: Instant,
    counters: IfCounters,
    /// The rates last derived for this interface, replayed while the agent's
    /// counters sit still.
    last_rates: IfRates,
    /// Consecutive polls this interface's counters have sat still.
    stale_streak: u32,
}

/// Did any counter we track move? `!=` rather than `>` so a wrap counts too.
fn any_counter_advanced(prev: &IfCounters, cur: &IfCounters) -> bool {
    [
        (prev.in_octets, cur.in_octets),
        (prev.out_octets, cur.out_octets),
        (prev.in_ucast, cur.in_ucast),
        (prev.in_mcast, cur.in_mcast),
        (prev.in_bcast, cur.in_bcast),
        (prev.out_ucast, cur.out_ucast),
        (prev.out_mcast, cur.out_mcast),
        (prev.out_bcast, cur.out_bcast),
        (prev.in_errors, cur.in_errors),
        (prev.out_errors, cur.out_errors),
        (prev.in_discards, cur.in_discards),
        (prev.out_discards, cur.out_discards),
    ]
    .iter()
    .any(|(p, c)| matches!((p, c), (Some(p), Some(c)) if p != c))
}

/// The rates derived for one interface in one poll. Every field is `Option`
/// because "we cannot know yet" is a first-class outcome here.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IfRates {
    pub bps_in: Option<f64>,
    pub bps_out: Option<f64>,
    pub pps_in: Option<f64>,
    pub pps_out: Option<f64>,
    pub util_in_pct: Option<f64>,
    pub util_out_pct: Option<f64>,
    pub in_errors_delta: Option<u64>,
    pub out_errors_delta: Option<u64>,
    pub in_discards_delta: Option<u64>,
    pub out_discards_delta: Option<u64>,
    /// The counters restarted between the two samples, so no rate is reportable.
    pub discontinuity: bool,
}

/// Holds the previous poll's readings and turns the current poll into rates.
pub struct SampleStore {
    per_if: HashMap<u32, IfSample>,
    last_sys_uptime: Option<u32>,
    width: CounterWidth,
    /// Longest run of consecutive polls in which an interface's counters did not
    /// move while it was otherwise reporting traffic. Surfaces an agent that
    /// refreshes its statistics far more slowly than we are polling.
    pub max_stale_streak: u32,
}

impl SampleStore {
    pub fn new(width: CounterWidth) -> Self {
        Self {
            per_if: HashMap::new(),
            last_sys_uptime: None,
            width,
            max_stale_streak: 0,
        }
    }

    pub fn width(&self) -> CounterWidth {
        self.width
    }

    /// Note this poll's `sysUpTime.0` and report whether the device rebooted
    /// since the last poll. A reboot restarts every counter, so the caller must
    /// void all rates for this cycle.
    pub fn observe_sys_uptime(&mut self, sys_uptime: Option<u32>) -> bool {
        let rebooted = match (self.last_sys_uptime, sys_uptime) {
            (Some(prev), Some(cur)) => cur < prev,
            _ => false,
        };
        if sys_uptime.is_some() {
            self.last_sys_uptime = sys_uptime;
        }
        if rebooted {
            // Every stored baseline is now meaningless.
            self.per_if.clear();
        }
        rebooted
    }

    /// Fold one interface's current readings into rates and store them as the
    /// next baseline.
    ///
    /// `device_rebooted` short-circuits everything to a discontinuity.
    pub fn update(
        &mut self,
        if_index: u32,
        counters: IfCounters,
        speed_mbps: Option<u32>,
        now: Instant,
        device_rebooted: bool,
    ) -> IfRates {
        let Some(prev) = self.per_if.get(&if_index) else {
            // First sighting of this interface: cumulative values are shown
            // immediately, rates appear on the next poll.
            self.per_if.insert(
                if_index,
                IfSample {
                    at: now,
                    counters,
                    last_rates: IfRates::default(),
                    stale_streak: 0,
                },
            );
            return IfRates::default();
        };
        let prev_at = prev.at;
        let prev_counters = prev.counters.clone();
        let prev_rates = prev.last_rates.clone();
        let prev_streak = prev.stale_streak;

        let dt_ms = now.saturating_duration_since(prev_at).as_millis() as u64;
        if dt_ms < MIN_ELAPSED_MS {
            // Too close together to divide by. Deliberately do NOT overwrite the
            // baseline — keeping the older one gives the next poll a usable dt.
            return IfRates::default();
        }

        let counter_reset = device_rebooted
            || discontinuity_advanced(
                prev_counters.discontinuity_time,
                counters.discontinuity_time,
            );

        if !counter_reset && !any_counter_advanced(&prev_counters, &counters) {
            // The agent has not published new statistics since the last poll.
            //
            // The baseline is deliberately NOT advanced, however long this goes
            // on: when the agent finally does publish, that delta covers the
            // whole silent stretch and has to be divided by it. Advancing the
            // baseline here is what turns a steady 14.7 Mbps into a phantom
            // 132 Mbps spike on the poll that breaks the silence.
            let streak = prev_streak.saturating_add(1);
            self.max_stale_streak = self.max_stale_streak.max(streak);
            if let Some(sample) = self.per_if.get_mut(&if_index) {
                sample.stale_streak = streak;
            }

            let zeroed_deltas = IfRates {
                in_errors_delta: Some(0),
                out_errors_delta: Some(0),
                in_discards_delta: Some(0),
                out_discards_delta: Some(0),
                ..IfRates::default()
            };
            return if dt_ms <= STALE_HOLD_MS {
                // Briefly, assume the agent is just slow and keep showing the
                // last measured rate rather than claiming the traffic stopped.
                IfRates {
                    in_errors_delta: Some(0),
                    out_errors_delta: Some(0),
                    in_discards_delta: Some(0),
                    out_discards_delta: Some(0),
                    ..prev_rates
                }
            } else {
                // Silent for long enough that continuing to display the old rate
                // would be inventing traffic. Report zero, but still hold the
                // baseline so the eventual delta is attributed correctly.
                IfRates {
                    bps_in: Some(0.0),
                    bps_out: Some(0.0),
                    pps_in: Some(0.0),
                    pps_out: Some(0.0),
                    util_in_pct: speed_mbps.filter(|s| *s > 0).map(|_| 0.0),
                    util_out_pct: speed_mbps.filter(|s| *s > 0).map(|_| 0.0),
                    ..zeroed_deltas
                }
            };
        }

        let rates = if counter_reset {
            IfRates {
                discontinuity: true,
                ..IfRates::default()
            }
        } else {
            self.derive(&prev_counters, &counters, dt_ms, speed_mbps)
        };

        self.per_if.insert(
            if_index,
            IfSample {
                at: now,
                counters,
                last_rates: rates.clone(),
                stale_streak: 0,
            },
        );
        rates
    }

    fn derive(
        &self,
        prev: &IfCounters,
        cur: &IfCounters,
        dt_ms: u64,
        speed_mbps: Option<u32>,
    ) -> IfRates {
        let width = self.width;

        let octet_delta = |p: Option<u64>, c: Option<u64>| -> Option<u64> {
            let delta = counter_delta(p?, c?, width)?;
            is_plausible_octet_delta(delta, dt_ms, speed_mbps).then_some(delta)
        };

        let bps_in =
            octet_delta(prev.in_octets, cur.in_octets).and_then(|d| bits_per_second(d, dt_ms));
        let bps_out =
            octet_delta(prev.out_octets, cur.out_octets).and_then(|d| bits_per_second(d, dt_ms));

        // Difference each sub-counter, then sum. A sub-counter the agent does
        // not implement contributes 0; one that is discontinuous voids the sum.
        let pkt_sum = |pairs: [(Option<u64>, Option<u64>); 3]| -> Option<u64> {
            let mut total = 0u64;
            let mut any = false;
            for (p, c) in pairs {
                match (p, c) {
                    (Some(p), Some(c)) => {
                        total = total.saturating_add(counter_delta(p, c, width)?);
                        any = true;
                    }
                    // Column absent on this agent — contributes nothing.
                    _ => continue,
                }
            }
            any.then_some(total)
        };

        let pps_in = pkt_sum([
            (prev.in_ucast, cur.in_ucast),
            (prev.in_mcast, cur.in_mcast),
            (prev.in_bcast, cur.in_bcast),
        ])
        .and_then(|d| packets_per_second(d, dt_ms));
        let pps_out = pkt_sum([
            (prev.out_ucast, cur.out_ucast),
            (prev.out_mcast, cur.out_mcast),
            (prev.out_bcast, cur.out_bcast),
        ])
        .and_then(|d| packets_per_second(d, dt_ms));

        // Error/discard counters get the wrap rule but no line-rate plausibility
        // gate — there is no bound to test them against.
        let plain_delta = |p: Option<u64>, c: Option<u64>| counter_delta(p?, c?, width);

        IfRates {
            bps_in,
            bps_out,
            pps_in,
            pps_out,
            util_in_pct: bps_in.and_then(|b| utilization_pct(b, speed_mbps)),
            util_out_pct: bps_out.and_then(|b| utilization_pct(b, speed_mbps)),
            in_errors_delta: plain_delta(prev.in_errors, cur.in_errors),
            out_errors_delta: plain_delta(prev.out_errors, cur.out_errors),
            in_discards_delta: plain_delta(prev.in_discards, cur.in_discards),
            out_discards_delta: plain_delta(prev.out_discards, cur.out_discards),
            discontinuity: false,
        }
    }

    /// Forget interfaces that were not present in this poll, so a removed line
    /// card does not pin memory for the life of the watcher.
    pub fn retain_indexes(&mut self, present: &[u32]) {
        self.per_if.retain(|ix, _| present.contains(ix));
    }

    #[cfg(test)]
    fn tracked(&self) -> usize {
        self.per_if.len()
    }
}

/// ifCounterDiscontinuityTime moving forward means the agent cleared this
/// interface's counters. A first non-zero reading after `None` also counts —
/// we have no baseline to prove the counters were continuous.
fn discontinuity_advanced(prev: Option<u32>, cur: Option<u32>) -> bool {
    match (prev, cur) {
        (Some(p), Some(c)) => c > p,
        (None, Some(c)) => c > 0,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const SEC_10: Duration = Duration::from_secs(10);

    fn counters_octets(in_o: u64, out_o: u64) -> IfCounters {
        IfCounters {
            in_octets: Some(in_o),
            out_octets: Some(out_o),
            ..IfCounters::default()
        }
    }

    // -- counter_delta ------------------------------------------------------

    #[test]
    fn counter_delta_normal_increase() {
        assert_eq!(counter_delta(100, 350, CounterWidth::Bits64), Some(250));
    }

    #[test]
    fn counter_delta_equal_is_zero() {
        assert_eq!(counter_delta(42, 42, CounterWidth::Bits64), Some(0));
    }

    #[test]
    fn counter_delta_c32_wrap() {
        let prev = (1u64 << 32) - 100;
        assert_eq!(counter_delta(prev, 50, CounterWidth::Bits32), Some(150));
    }

    #[test]
    fn counter_delta_c64_negative_is_reset_not_wrap() {
        // The whole point: no 2^64 correction, because a 64-bit counter that
        // went backwards was reset, not wrapped.
        assert_eq!(counter_delta(1_000_000, 5, CounterWidth::Bits64), None);
    }

    #[test]
    fn counter_delta_c32_rejects_out_of_range_previous() {
        // A "32-bit" reading above u32::MAX means the width was misdetected;
        // wrap-correcting it would produce garbage.
        assert_eq!(
            counter_delta(u64::from(u32::MAX) + 10, 5, CounterWidth::Bits32),
            None
        );
    }

    // -- plausibility -------------------------------------------------------

    #[test]
    fn plausibility_gate_rejects_impossible_c32_wrap() {
        // 500 MB in 10 s = 400 Mbps... on a 100 Mbps port. Not a wrap.
        assert!(!is_plausible_octet_delta(500_000_000, 10_000, Some(100)));
    }

    #[test]
    fn plausibility_gate_accepts_line_rate_with_headroom() {
        // Exactly 1 Gbps for 10 s on a 1 Gbps port.
        assert!(is_plausible_octet_delta(1_250_000_000, 10_000, Some(1000)));
    }

    #[test]
    fn plausibility_gate_skipped_when_speed_unknown() {
        assert!(is_plausible_octet_delta(u64::MAX / 2, 10_000, None));
        assert!(is_plausible_octet_delta(u64::MAX / 2, 10_000, Some(0)));
    }

    // -- rate formulas ------------------------------------------------------

    #[test]
    fn bits_per_second_basic() {
        // 1_250_000 octets over 10 s = 1 Mbps.
        assert_eq!(bits_per_second(1_250_000, 10_000), Some(1_000_000.0));
    }

    #[test]
    fn bits_per_second_zero_elapsed_is_none() {
        assert_eq!(bits_per_second(1000, 0), None);
        assert_eq!(packets_per_second(1000, 0), None);
    }

    #[test]
    fn utilization_half_line_rate() {
        assert_eq!(utilization_pct(500_000_000.0, Some(1000)), Some(50.0));
    }

    #[test]
    fn utilization_zero_high_speed_is_none() {
        assert_eq!(utilization_pct(1_000_000.0, Some(0)), None);
        assert_eq!(utilization_pct(1_000_000.0, None), None);
    }

    #[test]
    fn utilization_clamped() {
        let pct = utilization_pct(1e15, Some(10)).unwrap();
        assert_eq!(pct, MAX_UTIL_PCT);
    }

    // -- SampleStore --------------------------------------------------------

    #[test]
    fn first_sample_yields_no_rates() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let now = Instant::now();
        let rates = store.update(1, counters_octets(0, 0), Some(1000), now, false);
        assert_eq!(rates, IfRates::default());
        assert!(
            !rates.discontinuity,
            "a first sample is not a discontinuity"
        );
    }

    #[test]
    fn second_sample_yields_rates() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        let rates = store.update(
            1,
            counters_octets(1_250_000, 2_500_000),
            Some(1000),
            t0 + SEC_10,
            false,
        );
        assert_eq!(rates.bps_in, Some(1_000_000.0));
        assert_eq!(rates.bps_out, Some(2_000_000.0));
        assert_eq!(rates.util_in_pct, Some(0.1));
    }

    #[test]
    fn sample_not_overwritten_when_elapsed_below_minimum() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        store.update(1, counters_octets(0, 0), Some(1000), t0, false);

        // A too-fast poll returns no rates...
        let quick = store.update(
            1,
            counters_octets(1_000, 1_000),
            Some(1000),
            t0 + Duration::from_millis(100),
            false,
        );
        assert_eq!(quick, IfRates::default());

        // ...and must have left the ORIGINAL baseline in place, so a later poll
        // measures against t0, not against the discarded one.
        let later = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + SEC_10,
            false,
        );
        assert_eq!(later.bps_in, Some(1_000_000.0));
    }

    // --- slow-refreshing agents ------------------------------------------
    //
    // The device this models updates its counters on an internal ~10s tick while
    // we poll every 5s, so every other poll reads an unchanged value.

    #[test]
    fn static_counters_hold_the_last_rate_instead_of_reporting_zero() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let five = Duration::from_secs(5);

        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        // t+10s: the agent ticked, 1.25 MB in → 1 Mbps.
        let moved = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + SEC_10,
            false,
        );
        assert_eq!(moved.bps_in, Some(1_000_000.0));

        // t+15s: agent has not ticked again; the counter is identical.
        let held = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + SEC_10 + five,
            false,
        );
        assert_eq!(held.bps_in, Some(1_000_000.0), "should hold, not drop to 0");
        // Nothing moved, so nothing errored or was discarded this poll.
        assert_eq!(held.in_errors_delta, Some(0));
    }

    #[test]
    fn held_baseline_makes_the_next_rate_cover_the_true_interval() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let five = Duration::from_secs(5);

        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        // t+5s: no tick yet.
        store.update(1, counters_octets(0, 0), Some(1000), t0 + five, false);
        // t+10s: the agent ticked once, covering the whole 10 seconds.
        let rates = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + SEC_10,
            false,
        );

        // Dividing by 10s gives 1 Mbps. Had the held poll overwritten the
        // baseline, this would divide by 5s and report double the real rate.
        assert_eq!(rates.bps_in, Some(1_000_000.0));
    }

    #[test]
    fn genuinely_idle_interface_reports_zero_once_past_the_hold_window() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();

        store.update(1, counters_octets(5_000, 0), Some(1000), t0, false);
        let past_hold = Duration::from_millis(STALE_HOLD_MS + 1_000);
        let rates = store.update(
            1,
            counters_octets(5_000, 0),
            Some(1000),
            t0 + past_hold,
            false,
        );

        assert_eq!(
            rates.bps_in,
            Some(0.0),
            "a counter that has not moved for {STALE_HOLD_MS}ms really is idle"
        );
    }

    /// Measured against a real router: it left ifHCInOctets unchanged for nine
    /// consecutive 5s polls, then published 82,482,419 octets at once. Dividing
    /// that by one poll interval reports 132 Mbps; dividing it by the interval it
    /// actually covers reports the true ~14.7 Mbps. The baseline must therefore
    /// survive an arbitrarily long silence.
    #[test]
    fn a_long_silence_then_a_burst_reports_the_true_average() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let five = Duration::from_secs(5);

        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        // Nine polls with the counter frozen — well past STALE_HOLD_MS.
        for round in 1..=9 {
            store.update(
                1,
                counters_octets(0, 0),
                Some(1000),
                t0 + five * round,
                false,
            );
        }
        // Tenth poll: the agent publishes the whole 50 seconds at once.
        let rates = store.update(
            1,
            counters_octets(82_482_419, 0),
            Some(1000),
            t0 + five * 10,
            false,
        );

        let bps = rates.bps_in.expect("a rate should be reported");
        let expected = 82_482_419.0 * 8.0 / 50.0; // ~13.2 Mbps
        assert!(
            (bps - expected).abs() < 1.0,
            "expected ~{expected:.0} bps averaged over the silence, got {bps:.0}"
        );
        assert!(
            bps < 20_000_000.0,
            "must not attribute 50s of traffic to a single 5s poll"
        );
    }

    #[test]
    fn a_long_silence_is_reported_as_zero_not_as_a_stale_rate() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let five = Duration::from_secs(5);

        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + five,
            false,
        );

        // Just inside the hold window: keep showing the measured rate.
        let held = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + five * 2,
            false,
        );
        assert_eq!(held.bps_in, Some(2_000_000.0));

        // Well past it: continuing to show traffic would be inventing it.
        let quiet = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + Duration::from_millis(STALE_HOLD_MS + 10_000),
            false,
        );
        assert_eq!(quiet.bps_in, Some(0.0));
    }

    #[test]
    fn stale_streak_is_tracked_for_the_slow_agent_warning() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let five = Duration::from_secs(5);

        store.update(1, counters_octets(10, 0), Some(1000), t0, false);
        assert_eq!(store.max_stale_streak, 0);
        for round in 1..=4 {
            store.update(
                1,
                counters_octets(10, 0),
                Some(1000),
                t0 + five * round,
                false,
            );
        }
        assert_eq!(store.max_stale_streak, 4);

        // Movement resets the per-interface streak, but the observed maximum is
        // what the warning is based on, so it is retained.
        store.update(1, counters_octets(999, 0), Some(1000), t0 + five * 5, false);
        store.update(1, counters_octets(999, 0), Some(1000), t0 + five * 6, false);
        assert_eq!(store.max_stale_streak, 4);
    }

    #[test]
    fn hold_does_not_mask_a_counter_discontinuity() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let prev = IfCounters {
            discontinuity_time: Some(1000),
            ..counters_octets(1_000, 0)
        };
        // Octets unchanged, but the agent flagged a counter reset.
        let cur = IfCounters {
            discontinuity_time: Some(2000),
            ..counters_octets(1_000, 0)
        };
        store.update(1, prev, Some(1000), t0, false);
        let rates = store.update(1, cur, Some(1000), t0 + Duration::from_secs(5), false);
        assert!(rates.discontinuity, "a reset must win over the hold");
    }

    #[test]
    fn any_counter_advanced_detects_movement_in_any_field() {
        let base = IfCounters {
            in_octets: Some(10),
            out_octets: Some(10),
            in_errors: Some(0),
            ..IfCounters::default()
        };
        assert!(!any_counter_advanced(&base, &base));

        let moved_octets = IfCounters {
            in_octets: Some(11),
            ..base.clone()
        };
        assert!(any_counter_advanced(&base, &moved_octets));

        // A counter that only errored still counts as the agent having refreshed.
        let moved_errors = IfCounters {
            in_errors: Some(1),
            ..base.clone()
        };
        assert!(any_counter_advanced(&base, &moved_errors));

        // A wrap moves backwards but is still movement.
        let wrapped = IfCounters {
            in_octets: Some(1),
            ..base.clone()
        };
        assert!(any_counter_advanced(&base, &wrapped));
    }

    #[test]
    fn packet_deltas_summed_after_differencing() {
        let mut store = SampleStore::new(CounterWidth::Bits32);
        let t0 = Instant::now();
        // in_ucast is about to wrap; mcast/bcast are not.
        let prev = IfCounters {
            in_ucast: Some((1u64 << 32) - 100),
            in_mcast: Some(10),
            in_bcast: Some(5),
            ..IfCounters::default()
        };
        let cur = IfCounters {
            in_ucast: Some(50), // wrapped: +150
            in_mcast: Some(30), // +20
            in_bcast: Some(15), // +10
            ..IfCounters::default()
        };
        store.update(1, prev, None, t0, false);
        let rates = store.update(1, cur, None, t0 + SEC_10, false);
        // (150 + 20 + 10) packets over 10 s = 18 pps. Summing first would have
        // produced a negative delta and lost the reading entirely.
        assert_eq!(rates.pps_in, Some(18.0));
    }

    #[test]
    fn missing_packet_columns_do_not_void_the_sum() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let prev = IfCounters {
            in_ucast: Some(0),
            ..IfCounters::default()
        };
        let cur = IfCounters {
            in_ucast: Some(100),
            ..IfCounters::default()
        };
        store.update(1, prev, None, t0, false);
        let rates = store.update(1, cur, None, t0 + SEC_10, false);
        assert_eq!(rates.pps_in, Some(10.0));
        assert_eq!(
            rates.pps_out, None,
            "no out columns at all → nothing to report"
        );
    }

    #[test]
    fn discontinuity_time_increase_voids_that_interfaces_rates() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let prev = IfCounters {
            discontinuity_time: Some(1000),
            ..counters_octets(0, 0)
        };
        let cur = IfCounters {
            discontinuity_time: Some(2000),
            ..counters_octets(1_250_000, 0)
        };
        store.update(1, prev, Some(1000), t0, false);
        let rates = store.update(1, cur, Some(1000), t0 + SEC_10, false);
        assert!(rates.discontinuity);
        assert_eq!(
            rates.bps_in, None,
            "counters restarted — no rate is reportable"
        );
    }

    #[test]
    fn stable_discontinuity_time_does_not_void_rates() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let prev = IfCounters {
            discontinuity_time: Some(1000),
            ..counters_octets(0, 0)
        };
        let cur = IfCounters {
            discontinuity_time: Some(1000),
            ..counters_octets(1_250_000, 0)
        };
        store.update(1, prev, Some(1000), t0, false);
        let rates = store.update(1, cur, Some(1000), t0 + SEC_10, false);
        assert!(!rates.discontinuity);
        assert_eq!(rates.bps_in, Some(1_000_000.0));
    }

    #[test]
    fn sysuptime_regression_reports_reboot_and_clears_baselines() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        assert!(!store.observe_sys_uptime(Some(500_000)));
        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        assert_eq!(store.tracked(), 1);

        // Device rebooted: uptime went backwards.
        assert!(store.observe_sys_uptime(Some(100)));
        assert_eq!(store.tracked(), 0, "baselines must be dropped on reboot");
    }

    #[test]
    fn device_reboot_flag_voids_rates() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        store.update(1, counters_octets(0, 0), Some(1000), t0, false);
        let rates = store.update(
            1,
            counters_octets(1_250_000, 0),
            Some(1000),
            t0 + SEC_10,
            true,
        );
        assert!(rates.discontinuity);
        assert_eq!(rates.bps_in, None);
    }

    #[test]
    fn error_deltas_have_no_plausibility_gate() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let t0 = Instant::now();
        let prev = IfCounters {
            in_errors: Some(0),
            ..IfCounters::default()
        };
        let cur = IfCounters {
            in_errors: Some(9_000_000),
            ..IfCounters::default()
        };
        // Speed is 10 Mbps; 9M errors would fail an octet plausibility check,
        // but error counters are not bounded by line rate.
        store.update(1, prev, Some(10), t0, false);
        let rates = store.update(1, cur, Some(10), t0 + SEC_10, false);
        assert_eq!(rates.in_errors_delta, Some(9_000_000));
    }

    #[test]
    fn retain_indexes_drops_vanished_interfaces() {
        let mut store = SampleStore::new(CounterWidth::Bits64);
        let now = Instant::now();
        store.update(1, IfCounters::default(), None, now, false);
        store.update(2, IfCounters::default(), None, now, false);
        store.update(3, IfCounters::default(), None, now, false);
        store.retain_indexes(&[1, 3]);
        assert_eq!(store.tracked(), 2);
    }

    #[test]
    fn discontinuity_advanced_rules() {
        assert!(discontinuity_advanced(Some(10), Some(20)));
        assert!(!discontinuity_advanced(Some(20), Some(20)));
        assert!(
            !discontinuity_advanced(Some(20), Some(10)),
            "clock cannot go back without a reboot; treat as no-op"
        );
        assert!(discontinuity_advanced(None, Some(5)));
        assert!(!discontinuity_advanced(None, Some(0)));
        assert!(!discontinuity_advanced(Some(5), None));
    }
}
