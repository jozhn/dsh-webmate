window.__ModuleLoader__.load({
  id: 'dsh-webmate',
  factory() {
    // 读取渲染正文，不主动读取 Cookie、存储或表单值。
    function extractPage(offset, limit) {
      const cap = 1000000;
      const parts = [];
      const frames = [];
      let used = 0;
      let capped = false;
      let framesTruncated = false;
      function append(text) {
        const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
        if (!clean) return;
        const remaining = Math.max(0, cap - used);
        if (clean.length > remaining) capped = true;
        const part = clean.slice(0, remaining);
        if (part) { parts.push(part); used += part.length + 2; }
      }
      function walk(doc, depth) {
        append(doc.body?.innerText || '');
        const children = [...doc.querySelectorAll('iframe,frame')];
        if (depth >= 3) { if (children.length) framesTruncated = true; return; }
        if (children.length > 20) framesTruncated = true;
        for (const frame of children.slice(0, 20)) {
          if (used >= cap) { capped = true; break; }
          if (!frame.getClientRects().length || frame.closest('[hidden],[aria-hidden="true"]')) continue;
          try {
            const child = frame.contentDocument;
            if (!child || !child.body) throw new Error('unavailable');
            append('\n[嵌入页面：' + (child.title || child.location.href) + ']\n');
            walk(child, depth + 1);
          } catch {
            frames.push({ url: String(frame.src || '').slice(0, 2000), readable: false, reason: '跨域或尚未加载的嵌入页面' });
          }
        }
      }
      walk(document, 0);
      const full = parts.join('\n\n').slice(0, cap);
      const text = full.slice(offset, offset + limit);
      return {
        title: document.title, url: location.href, text, offset, totalCharacters: full.length,
        nextOffset: offset + text.length < full.length ? offset + text.length : null,
        truncated: offset + text.length < full.length || capped,
        sourceCapped: capped, framesTruncated, unreadableFrames: frames,
        readyState: document.readyState, capturedAt: new Date().toISOString(),
      };
    }

    // 用户代码由原生 guest 执行；Client 只将已返回的值转换为有界 JSON。
    function normalizeResult(value) {
      try {
        if (value === undefined) return { ok: true, result: null, resultType: 'undefined' };
        const text = JSON.stringify(value, (_key, item) => {
          if (typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol') throw new Error('返回值含非 JSON 类型，请显式转换后返回');
          if (item instanceof Node) throw new Error('请返回 DOM 节点的文本或属性，不能直接返回 DOM 节点');
          if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('返回值包含非有限数值');
          return item;
        });
        if (typeof text !== 'string') throw new Error('返回值无法转换为 JSON');
        if (text.length > 50000) throw new Error('脚本返回结果超过 50000 字符；操作可能已经执行，请单独读取所需结果，不要重复操作');
        return { ok: true, result: JSON.parse(text), resultType: value === null ? 'null' : typeof value };
      } catch (reason) {
        return { ok: false, error: String(reason instanceof Error ? reason.message : reason).slice(0, 2000) };
      }
    }

    return {
      inject: ['connection', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => {
          const lifetime = new AbortController();
          const clientId = crypto.randomUUID();
          let active;
          let sessionId;
          const call = async (endpoint, payload, signal) => {
            const response = await ctx.connection.rpc.call('/sidebar-reader', 'sidebarReader.' + endpoint, { clientId, ...payload }, signal);
            if (!response.ok) throw new Error(response.error.message);
            return response.value;
          };
          function candidates(requestSessionId) {
            if (ctx.sidebarRight.mounted.getSnapshot() !== requestSessionId) throw new Error('请切回发起请求的 DSH 会话');
            const tabs = ctx.sidebarRight.openTabs.getSnapshot();
            return [...document.querySelectorAll('webview[data-sidebar-browser-frame="webview"]')].flatMap(view => {
              if (view.closest('[hidden],[aria-hidden="true"]') || !view.getClientRects().length) return [];
              if (typeof view.checkVisibility === 'function' && !view.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return [];
              const target = ctx.sidebarRight.focusedTarget(view);
              if (!target || target.sessionId !== requestSessionId || !tabs.some(tab => tab.sessionId === requestSessionId && tab.tabId === target.tabId && tab.kind === 'browser')) return [];
              try {
                const url = view.getURL();
                if (!/^https?:\/\//i.test(url)) return [];
                return [{ view, target, tabId: target.tabId, title: view.getTitle(), url }];
              } catch { return []; }
            });
          }
          function currentSelection(selected, requestSessionId) {
            try { return candidates(requestSessionId).find(item => item.view === selected.view && item.tabId === selected.tabId && item.target.occurrence === selected.target.occurrence); }
            catch { return undefined; }
          }
          async function executeScript(selected, job, signal) {
            let navigated = false;
            const onNavigation = event => { if (event.isMainFrame !== false) navigated = true; };
            selected.view.addEventListener('did-start-navigation', onNavigation);
            const metadata = () => {
              let urlAfter = null;
              try { if (selected.view.isConnected) urlAfter = selected.view.getURL(); } catch { /* guest 已关闭时保留未知网址。 */ }
              return { tabId: selected.tabId, urlBefore: selected.url, urlAfter,
                navigationChanged: navigated || urlAfter !== selected.url, automaticRetryAllowed: false };
            };
            try {
              const value = await bounded(selected.view.executeJavaScript(job.script, false), signal, '脚本执行超过 10 秒');
              signal.throwIfAborted();
              const result = normalizeResult(value);
              const current = currentSelection(selected, job.sessionId);
              if (!current) return { ...metadata(), executionStatus: 'uncertain', note: '操作可能已经执行，但会话或可见标签已变化，已丢弃返回值。操作不能自动撤销，请先检查页面状态，不要自动重试。' };
              const meta = metadata();
              meta.navigationChanged ||= current.target.navigationRevision !== selected.target.navigationRevision;
              if (!result || typeof result.ok !== 'boolean') throw new Error('脚本未返回有效执行结果');
              if (!result.ok) return { ...meta, executionStatus: 'error', error: result.error,
                note: '脚本异常或结果转换失败；异常前的操作可能已经执行，不能自动撤销。请先检查页面状态，不要自动重试。' };
              return { ...meta, executionStatus: 'completed', result: result.result, resultType: result.resultType,
                ...(meta.navigationChanged ? { note: '脚本已返回，页面发生了导航；请检查新页面状态，不要重复执行原操作。' } : {}) };
            } catch (reason) {
              return { ...metadata(), executionStatus: 'uncertain', error: String(reason instanceof Error ? reason.message : reason).slice(0, 2000),
                note: '脚本可能已经执行，也可能仍在执行；超时或取消不能终止网页脚本，不能自动撤销。请先检查页面状态，不要自动重试。' };
            } finally { selected.view.removeEventListener('did-start-navigation', onNavigation); }
          }
          async function handle(job, signal) {
            signal.throwIfAborted();
            if (!['list', 'read', 'execute_js'].includes(job.action)) throw new Error('未知的网页操作');
            const available = candidates(job.sessionId);
            const tabs = available.map(({ tabId, title, url }) => ({ tabId, title, url }));
            if (job.action === 'list') return { tabs, note: '仅列出当前会话中可见且已加载的 Desktop 网页。' };
            const matches = job.tabId ? available.filter(item => item.tabId === job.tabId) : available;
            if (!matches.length) throw new Error('没有可操作的可见网页。请在当前会话右侧打开目标网页并等待加载；此功能需要 Desktop 内嵌浏览器。');
            if (matches.length !== 1) throw new Error('有多个可见网页，请先使用 list 获取 tabId，再指定 tab_id 操作。');
            const selected = matches[0];
            if (typeof selected.view.executeJavaScript !== 'function') throw new Error('此网页容器不支持读取或脚本操作，请使用 Desktop 内嵌浏览器。');
            if (job.action === 'execute_js') {
              if (typeof job.script !== 'string' || !job.script.trim()) throw new Error('script 必须为非空 JavaScript 字符串');
              return executeScript(selected, job, signal);
            }
            if (!Number.isSafeInteger(job.offset) || job.offset < 0 || job.offset > 1000000 || !Number.isSafeInteger(job.limit) || job.limit < 1 || job.limit > 50000) throw new Error('正文分页参数无效');
            const source = '(' + extractPage.toString() + ')(' + job.offset + ',' + job.limit + ')';
            const result = await bounded(selected.view.executeJavaScript(source, false), signal, '页面正文读取超时，请等待网页加载完成后重试');
            signal.throwIfAborted();
            const current = currentSelection(selected, job.sessionId);
            if (!current || current.target.navigationRevision !== selected.target.navigationRevision || current.url !== selected.url || result.url !== selected.url) throw new Error('读取期间会话、标签或网址发生变化，请重新读取当前页面');
            return { tabId: selected.tabId, ...result };
          }
          async function run(requestSessionId, signal) {
            while (!signal.aborted) {
              try {
                const job = await call('poll', { sessionId: requestSessionId }, signal);
                if (!job) continue;
                let result = null;
                let error = null;
                try { result = await handle(job, signal); }
                catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
                // 每项任务只执行一次；完成上报失败也不能再次执行网页操作。
                await call('complete', { id: job.id, result, error }, lifetime.signal);
              } catch (error) {
                if (signal.aborted) return;
                console.warn('[dsh-webmate]', error instanceof Error ? error.message : String(error));
                await delay(3000, signal);
              }
            }
          }
          function update() {
            const next = ctx.sidebarRight.mounted.getSnapshot();
            if (next === sessionId) return;
            active?.abort();
            sessionId = next;
            if (!next || lifetime.signal.aborted) return;
            active = new AbortController();
            void run(next, active.signal);
          }
          const unsubscribe = ctx.sidebarRight.mounted.subscribe(update);
          update();
          return () => { lifetime.abort(); active?.abort(); unsubscribe(); };
        });
      },
    };

    function delay(ms, signal) {
      return new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, ms);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
    }
    function bounded(promise, signal, timeoutMessage) {
      return new Promise((resolve, reject) => {
        const finish = (error, value) => {
          clearTimeout(timer); signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(value);
        };
        const abort = () => finish(signal.reason || new Error('网页操作已取消'));
        const timer = setTimeout(() => finish(new Error(timeoutMessage)), 10000);
        signal.addEventListener('abort', abort, { once: true });
        promise.then(value => finish(null, value), error => finish(error));
        if (signal.aborted) abort();
      });
    }
  },
});
