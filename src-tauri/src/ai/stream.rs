//! Cancellation state for the single active LLM stream.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

#[derive(Clone, Default)]
pub struct StreamCancel {
    inner: Arc<CancelInner>,
}

#[derive(Default)]
struct CancelInner {
    cancelled: AtomicBool,
    /// Number of characters already delivered to the user. Retry logic uses
    /// this to avoid re-running a stream that already produced output.
    emitted: AtomicUsize,
    notify: Notify,
}

impl StreamCancel {
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::Release);
        self.inner.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::Acquire)
    }

    pub fn note_emitted(&self, chars: usize) {
        self.inner.emitted.fetch_add(chars, Ordering::Relaxed);
    }

    pub fn emitted_count(&self) -> usize {
        self.inner.emitted.load(Ordering::Relaxed)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.inner.notify.notified().await;
    }

    fn same_as(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }
}

#[derive(Default)]
pub struct ActiveStream {
    current: Mutex<Option<StreamCancel>>,
}

impl ActiveStream {
    pub fn begin(&self) -> StreamCancel {
        let mut current = self.current.lock();
        if let Some(previous) = current.take() {
            previous.cancel();
        }
        let token = StreamCancel::default();
        *current = Some(token.clone());
        token
    }

    pub fn stop(&self) {
        if let Some(token) = self.current.lock().as_ref() {
            token.cancel();
        }
    }

    pub fn clear_if_current(&self, token: &StreamCancel) {
        let mut current = self.current.lock();
        if current
            .as_ref()
            .map(|candidate| candidate.same_as(token))
            .unwrap_or(false)
        {
            *current = None;
        }
    }
}