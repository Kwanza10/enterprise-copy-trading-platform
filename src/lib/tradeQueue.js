// Lightweight in-memory FIFO queue. Processes one trade event at a time so a
// burst of webhook/poll events can't spike CPU/memory on a 1GB VPS; each
// event's own fan-out to followers still runs concurrently inside the
// processor (see copyEngine.processTradeEvent's Promise.allSettled).
const queue = [];
let processor = null;
let draining = false;

function setProcessor(fn) {
  processor = fn;
}

function push(item) {
  queue.push(item);
  drain();
}

async function drain() {
  if (draining || !processor) return;
  draining = true;

  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await processor(item);
    } catch (error) {
      console.error('Trade queue processor failed:', error.message);
    }
  }

  draining = false;
}

function size() {
  return queue.length;
}

module.exports = { setProcessor, push, size };
