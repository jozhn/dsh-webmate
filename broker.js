import { randomUUID } from 'node:crypto';

// 仅在当前会话的前端长连接与工具调用之间传递一次性任务，不持久化网页正文。
export class ReaderBroker {
  constructor({ timeoutMs = 15000, pollMs = 20000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.waiters = new Map();
    this.jobs = new Map();
    this.closed = false;
  }

  poll(clientId, sessionId, signal) {
    if (this.closed) throw new Error('网页读取插件已停用');
    signal.throwIfAborted();
    this.waiters.get(clientId)?.finish(null);
    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (this.waiters.get(clientId) === waiter) this.waiters.delete(clientId);
        resolve(value);
      };
      const abort = () => finish(null);
      const waiter = { clientId, sessionId, finish };
      const timer = setTimeout(() => finish(null), this.pollMs);
      signal.addEventListener('abort', abort, { once: true });
      this.waiters.set(clientId, waiter);
      this.dispatch(sessionId);
    });
  }

  request(sessionId, args, signal) {
    if (this.closed) return Promise.reject(new Error('网页读取插件已停用'));
    signal.throwIfAborted();
    if ([...this.jobs.values()].some(job => job.sessionId === sessionId)) {
      return Promise.reject(new Error('当前会话已有网页读取请求，请等待其完成'));
    }
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const finish = (error, value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.jobs.delete(id);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(signal.reason ?? new Error('网页读取已取消'));
      const timer = setTimeout(() => finish(new Error('未收到当前会话网页响应。请保持 DSH 桌面窗口和右侧网页可见；首次安装后若前端尚未加载插件，请刷新 DSH 界面。')), this.timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      this.jobs.set(id, { id, sessionId, args, finish, clientId: null });
      this.dispatch(sessionId);
    });
  }

  dispatch(sessionId) {
    const job = [...this.jobs.values()].find(item => item.sessionId === sessionId && !item.clientId);
    if (!job) return;
    const waiters = [...this.waiters.values()].filter(item => item.sessionId === sessionId);
    if (waiters.length > 1) {
      job.finish(new Error('同一会话在多个 DSH 窗口中打开，请仅保留一个显示此会话的窗口后读取'));
      return;
    }
    const waiter = waiters[0];
    if (!waiter) return;
    job.clientId = waiter.clientId;
    waiter.finish({ id: job.id, sessionId, ...job.args });
  }

  complete(clientId, id, result, error) {
    const job = this.jobs.get(id);
    if (!job || job.clientId !== clientId) return false;
    if (error) job.finish(new Error(String(error).slice(0, 2000)));
    else job.finish(null, result);
    return true;
  }

  dispose() {
    this.closed = true;
    for (const waiter of [...this.waiters.values()]) waiter.finish(null);
    for (const job of [...this.jobs.values()]) job.finish(new Error('网页读取插件已停用'));
  }
}
