//! Reap must send SIGKILL even when the runtime never polls its queued wait task.
use super::*;

#[test]
fn maxcode_reap_signals_before_the_runtime_can_poll() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let entered = runtime.enter();
    let child = tokio_command("sleep")
        .arg("60")
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let pid = child.id().unwrap() as libc::pid_t;
    reap(child);
    // No block_on: the old implementation queues the kill forever here.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    let mut status = 0;
    let killed = loop {
        // SAFETY: pid is our own child; status points to writable stack memory.
        let result = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if result == pid {
            break libc::WIFSIGNALED(status) && libc::WTERMSIG(status) == libc::SIGKILL;
        }
        if result < 0 || std::time::Instant::now() >= deadline {
            break false;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    drop(entered);
    drop(runtime); // kill_on_drop is only a cleanup safety net for a failing test.
    assert!(
        killed,
        "reap must kill synchronously, before any task is polled"
    );
}
