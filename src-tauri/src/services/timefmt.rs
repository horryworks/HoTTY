//! Wall-clock timestamp formatting shared by the polling features.
//!
//! Extracted from `ping_monitor.rs` when the Interface Traffic Watcher needed
//! the same "YYYY-MM-DD HH:MM:SS.mmm" stamp in its event payloads. The project
//! has no `chrono` dependency on purpose (it is a large tree for what amounts to
//! one civil-date conversion), so the calendar math lives here once rather than
//! being copied per feature.

/// `YYYY-MM-DD HH:MM:SS.mmm` in UTC — the stamp shown in pane tables and written
/// to CSV logs. Always 23 characters.
pub fn format_timestamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

/// `YYYYMMDDHHMMSS` — filename-safe variant used for per-session log files.
/// Always 14 characters.
pub fn format_file_timestamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}{month:02}{day:02}{hours:02}{minutes:02}{seconds:02}")
}

/// Days since the Unix epoch to `(year, month, day)`.
///
/// Howard Hinnant's civil-from-days algorithm: shift the epoch to 0000-03-01 so
/// the leap day lands at the end of the year, then do era (400-year) arithmetic.
fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    days += 719_468;
    let era = days / 146_097;
    let doe = days % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_timestamp_length() {
        // YYYY-MM-DD HH:MM:SS.mmm = 23 chars
        assert_eq!(format_timestamp().len(), 23);
    }

    #[test]
    fn format_file_timestamp_length() {
        // YYYYMMDDHHMMSS = 14 chars
        assert_eq!(format_file_timestamp().len(), 14);
    }

    #[test]
    fn days_to_ymd_unix_epoch() {
        assert_eq!(days_to_ymd(0), (1970, 1, 1));
    }

    #[test]
    fn days_to_ymd_handles_leap_day() {
        // 2020-02-29 is 18321 days after the epoch.
        assert_eq!(days_to_ymd(18_321), (2020, 2, 29));
    }

    #[test]
    fn days_to_ymd_century_non_leap() {
        // 1900 was not a leap year; 2000 was. 2000-03-01 = 11017 days.
        assert_eq!(days_to_ymd(11_017), (2000, 3, 1));
    }
}
