//! Shared reader pipeline for the protocols whose transport only offers a
//! **blocking** read: local shell (ConPTY), WSL, gcloud IAP and serial.
//!
//! It replaces the "one `tokio::spawn`, blocking `read()` inside, emit per
//! chunk" shape those four used to share, and fixes two distinct problems.
//!
//! **Worker starvation.** A blocking `read()` inside a plain `tokio::spawn`
//! parks one of the runtime's `available_parallelism()` worker threads for the
//! whole life of the session — four open shells could leave a 4-core machine
//! with nothing left to run async work on. The read now lives on
//! `spawn_blocking`, whose pool is sized for exactly this. Cancellation is no
//! worse than before: `abort()` could never interrupt a thread parked in a
//! blocking syscall either, which is why local/WSL/IAP kill their child (and
//! serial drops its port) on disconnect to make the read return.
//!
//! **Emit amplification.** Every `read()` return used to become its own
//! `session-data` event, and each event costs a `serde_json` serialize (ESC
//! becomes a 6-byte ``), a JS wrapper `format!`, and a WebView2
//! `ExecuteScript` marshalled to the UI thread. The emitter task instead
//! concatenates whatever has **already queued** behind the first event before
//! emitting, so bulk output (`cat` of a large file) collapses into far fewer,
//! much larger events.
//!
//! The coalescing adds **no latency**: the emitter never waits for more data,
//! it only takes what is sitting in the channel at that instant. An interactive
//! keystroke echo has nothing queued behind it and is emitted immediately, as
//! one event, exactly as before.

use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::log_manager::LogManager;
use super::session_service::{emit_session_data, emit_session_error, emit_session_status};

/// Upper bound on the bytes concatenated into a single `session-data` event.
///
/// Large enough that a fast `cat` collapses into a handful of events, small
/// enough that one serialize + `ExecuteScript` stays comfortably sub-frame.
/// Shared with the async protocols (SSH/Telnet), which coalesce inline in their
/// own reader loops rather than through this pump, so every protocol emits at
/// the same granularity.
pub(crate) const MAX_COALESCE_BYTES: usize = 64 * 1024;

/// Depth of the reader → emitter channel. Bounded on purpose: if the UI thread
/// stalls, the reader blocks on send rather than growing an unbounded backlog
/// of terminal output in memory.
const CHANNEL_DEPTH: usize = 256;

/// Outcome of one blocking read attempt, returned by a protocol's read closure.
pub enum ReadStep {
    /// Decoded text was read. Empty strings are ignored.
    Data(String),
    /// Nothing arrived this time (e.g. a serial read timeout) — try again.
    Idle,
    /// The transport closed cleanly.
    Eof,
    /// The transport failed. The message is already humanized for the user.
    Error(String),
}

/// What the reader thread hands to the emitter task.
#[derive(Debug, PartialEq)]
enum ReadEvent {
    Data(String),
    Eof,
    Error(String),
}

impl ReadEvent {
    /// A terminating event ends the session; nothing may be coalesced past it.
    fn is_terminal(&self) -> bool {
        !matches!(self, ReadEvent::Data(_))
    }

    fn byte_len(&self) -> usize {
        match self {
            ReadEvent::Data(s) => s.len(),
            _ => 0,
        }
    }
}

/// One emit the emitter task should perform, in order.
#[derive(Debug, PartialEq)]
enum EmitAction {
    Data(String),
    Eof,
    Error(String),
}

/// Fold a batch of received events into the emits they produce.
///
/// Pure (no Tauri, no I/O) so the ordering guarantee this pipeline rests on is
/// unit-testable: **a terminating event never overtakes the data queued ahead
/// of it**, so a session-exit can't be delivered while its final output is
/// still sitting in the coalescing buffer.
fn plan_emits(events: Vec<ReadEvent>, max_bytes: usize) -> Vec<EmitAction> {
    let mut out = Vec::new();
    let mut pending = String::new();

    for event in events {
        match event {
            ReadEvent::Data(text) => {
                if pending.is_empty() {
                    pending = text;
                } else {
                    pending.push_str(&text);
                }
                if pending.len() >= max_bytes {
                    out.push(EmitAction::Data(std::mem::take(&mut pending)));
                }
            }
            ReadEvent::Eof => {
                if !pending.is_empty() {
                    out.push(EmitAction::Data(std::mem::take(&mut pending)));
                }
                out.push(EmitAction::Eof);
            }
            ReadEvent::Error(message) => {
                if !pending.is_empty() {
                    out.push(EmitAction::Data(std::mem::take(&mut pending)));
                }
                out.push(EmitAction::Error(message));
            }
        }
    }

    if !pending.is_empty() {
        out.push(EmitAction::Data(pending));
    }
    out
}

/// Spawn the blocking reader thread and its coalescing emitter task for a
/// session, returning both handles so the caller can push them onto its
/// teardown list (`join_or_abort`).
///
/// `read_chunk` runs on a dedicated blocking thread and owns everything the
/// protocol's read needs — the reader, its buffer, its encoding, and any handle
/// (e.g. the pty master) that must stay alive while the read loop runs, since
/// the closure is dropped when the thread finishes.
///
/// `cancel` is checked between reads and ends both tasks without emitting
/// `disconnected` — a cancel means `disconnect()` drove the teardown, so the
/// frontend has already removed the pane. It cannot interrupt a read that is
/// already parked in a syscall (nothing can), so protocols that can be idle for
/// a long time must also make the read *return*: local/WSL/IAP kill their child
/// to close the pty, and serial's port timeout brings the loop back around
/// roughly every 100 ms.
///
/// `proto` is the short protocol name used in log lines ("local", "wsl", …).
pub fn spawn_read_pump<F>(
    app: AppHandle,
    session_id: String,
    log_mgr: LogManager,
    proto: &'static str,
    cancel: CancellationToken,
    read_chunk: F,
) -> (JoinHandle<()>, JoinHandle<()>)
where
    F: FnMut() -> ReadStep + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<ReadEvent>(CHANNEL_DEPTH);

    let reader_sid = session_id.clone();
    let reader_cancel = cancel.clone();
    let reader_join = tokio::task::spawn_blocking(move || {
        let mut read_chunk = read_chunk;
        log::info!("{proto} reader thread started for {reader_sid}");
        loop {
            if reader_cancel.is_cancelled() {
                break;
            }
            let event = match read_chunk() {
                ReadStep::Idle => continue,
                ReadStep::Data(text) => {
                    if text.is_empty() {
                        continue;
                    }
                    ReadEvent::Data(text)
                }
                ReadStep::Eof => {
                    log::info!("{proto} {reader_sid}: transport closed (EOF)");
                    let _ = tx.blocking_send(ReadEvent::Eof);
                    break;
                }
                ReadStep::Error(message) => {
                    log::error!("{proto} {reader_sid}: read error: {message}");
                    let _ = tx.blocking_send(ReadEvent::Error(message));
                    break;
                }
            };
            // A send failure means the emitter is gone (session torn down);
            // there is nowhere left to deliver output, so stop reading.
            if tx.blocking_send(event).is_err() {
                break;
            }
        }
        log::info!("{proto} reader thread finished for {reader_sid}");
    });

    let emitter_join = tokio::spawn(async move {
        let mut rx = rx;
        loop {
            // Block for the first event, then take only what is ALREADY queued
            // behind it — never wait for more. CancellationToken is
            // level-triggered, so there is no lost-wakeup race here.
            let first = tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                event = rx.recv() => match event {
                    Some(event) => event,
                    None => break,
                },
            };
            let mut bytes = first.byte_len();
            let mut batch_ended = first.is_terminal();
            let mut batch = vec![first];

            while !batch_ended && bytes < MAX_COALESCE_BYTES {
                match rx.try_recv() {
                    Ok(event) => {
                        bytes += event.byte_len();
                        batch_ended = event.is_terminal();
                        batch.push(event);
                    }
                    Err(_) => break,
                }
            }

            let mut finished = false;
            for action in plan_emits(batch, MAX_COALESCE_BYTES) {
                match action {
                    EmitAction::Data(text) => {
                        // Clone only when a log will actually consume the text.
                        // Emit first so the UI never waits on a disk write.
                        if log_mgr.is_logging_active() {
                            emit_session_data(&app, &session_id, text.clone());
                            log_mgr.write(&session_id, &text).await;
                        } else {
                            emit_session_data(&app, &session_id, text);
                        }
                    }
                    EmitAction::Eof => {
                        log_mgr.stop_logging(&session_id).await;
                        emit_session_status(&app, &session_id, "disconnected");
                        finished = true;
                    }
                    EmitAction::Error(message) => {
                        log_mgr.stop_logging(&session_id).await;
                        emit_session_error(&app, &session_id, message);
                        emit_session_status(&app, &session_id, "disconnected");
                        finished = true;
                    }
                }
            }
            if finished {
                break;
            }
        }
    });

    (reader_join, emitter_join)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(s: &str) -> ReadEvent {
        ReadEvent::Data(s.to_string())
    }

    #[test]
    fn consecutive_data_events_become_one_emit() {
        let actions = plan_emits(vec![data("ab"), data("cd"), data("ef")], MAX_COALESCE_BYTES);
        assert_eq!(actions, vec![EmitAction::Data("abcdef".to_string())]);
    }

    #[test]
    fn eof_never_overtakes_buffered_data() {
        let actions = plan_emits(vec![data("bye"), ReadEvent::Eof], MAX_COALESCE_BYTES);
        assert_eq!(
            actions,
            vec![EmitAction::Data("bye".to_string()), EmitAction::Eof]
        );
    }

    #[test]
    fn error_never_overtakes_buffered_data() {
        let actions = plan_emits(
            vec![data("partial"), ReadEvent::Error("cable unplugged".into())],
            MAX_COALESCE_BYTES,
        );
        assert_eq!(
            actions,
            vec![
                EmitAction::Data("partial".to_string()),
                EmitAction::Error("cable unplugged".to_string()),
            ]
        );
    }

    #[test]
    fn terminator_with_no_pending_data_emits_alone() {
        assert_eq!(
            plan_emits(vec![ReadEvent::Eof], MAX_COALESCE_BYTES),
            vec![EmitAction::Eof]
        );
    }

    #[test]
    fn the_byte_cap_splits_a_long_run_into_several_emits() {
        // Four 3-byte chunks with a 6-byte cap: flush at 6, flush at 6.
        let actions = plan_emits(vec![data("aaa"), data("bbb"), data("ccc"), data("ddd")], 6);
        assert_eq!(
            actions,
            vec![
                EmitAction::Data("aaabbb".to_string()),
                EmitAction::Data("cccddd".to_string()),
            ]
        );
    }

    #[test]
    fn a_single_oversized_chunk_is_not_split_mid_character() {
        // The cap bounds coalescing, it never slices a chunk — splitting a
        // String by bytes could cut a multi-byte character in half.
        let big = "あ".repeat(10); // 30 bytes
        let actions = plan_emits(vec![ReadEvent::Data(big.clone())], 6);
        assert_eq!(actions, vec![EmitAction::Data(big)]);
    }

    #[test]
    fn data_after_a_terminator_still_emits_in_order() {
        // Shouldn't happen (the reader stops at a terminator), but the planner
        // must not silently drop anything if it ever does.
        let actions = plan_emits(vec![ReadEvent::Eof, data("late")], MAX_COALESCE_BYTES);
        assert_eq!(
            actions,
            vec![EmitAction::Eof, EmitAction::Data("late".to_string())]
        );
    }
}
