import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderBroker } from './broker.js';
import { apply } from './host.js';

const signal = () => new AbortController().signal;

test('只向相同会话前端派发，且拒绝其他前端完成任务', async () => {
  const broker = new ReaderBroker({ timeoutMs: 1000, pollMs: 1000 });
  try {
    const other = broker.poll('other', 'session-b', signal());
    const poll = broker.poll('client', 'session-a', signal());
    const result = broker.request('session-a', { action: 'read' }, signal());
    const job = await poll;
    assert.equal(job.sessionId, 'session-a');
    assert.equal(broker.complete('other', job.id, { text: 'wrong' }), false);
    assert.equal(broker.complete('client', job.id, { text: '正文' }), true);
    assert.deepEqual(await result, { text: '正文' });
    broker.dispose();
    assert.equal(await other, null);
  } finally { broker.dispose(); }
});

test('工具先发起时，稍后到达的前端仍能接收任务', async () => {
  const broker = new ReaderBroker();
  try {
    const result = broker.request('s', { action: 'list' }, signal());
    const job = await broker.poll('c', 's', signal());
    broker.complete('c', job.id, { tabs: [] });
    assert.deepEqual(await result, { tabs: [] });
  } finally { broker.dispose(); }
});

test('取消和超时后拒绝迟到回包并清理任务', async () => {
  const broker = new ReaderBroker({ timeoutMs: 15, pollMs: 1000 });
  try {
    const ctrl = new AbortController();
    const first = broker.request('s', {}, ctrl.signal);
    const job = await broker.poll('c', 's', signal());
    ctrl.abort(new Error('用户取消'));
    await assert.rejects(first, /用户取消/);
    assert.equal(broker.complete('c', job.id, { text: 'late' }), false);
    await assert.rejects(broker.request('s', {}, signal()), /未收到当前会话网页响应/);
    assert.equal(broker.jobs.size, 0);
  } finally { broker.dispose(); }
});

test('卸载同时释放前端等待和工具等待', async () => {
  const broker = new ReaderBroker();
  const poll = broker.poll('c', 's1', signal());
  const result = broker.request('s2', {}, signal());
  broker.dispose();
  assert.equal(await poll, null);
  await assert.rejects(result, /停用/);
  assert.equal(broker.jobs.size, 0);
  assert.equal(broker.waiters.size, 0);
});

test('多个窗口显示同一会话时不给任意窗口派发', async () => {
  const broker = new ReaderBroker();
  try {
    const p1 = broker.poll('c1', 's', signal());
    const p2 = broker.poll('c2', 's', signal());
    await assert.rejects(broker.request('s', {}, signal()), /多个 DSH 窗口/);
    broker.dispose();
    await Promise.all([p1, p2]);
  } finally { broker.dispose(); }
});

test('实际插件注册工具与 RPC，读取结果由工具返回', async () => {
  let definition, rpc;
  const disposers = [];
  apply({
    effect(factory) { disposers.push(factory()); },
    connection: { rpc: { handle(channel, handler) { assert.equal(channel, '/sidebar-reader'); rpc = handler; } } },
    tools: { register(tool) { definition = tool; } },
  });
  try {
    const exec = { agent: { session: { id: 'session' } }, signal: signal() };
    await assert.rejects(definition.execute({ action: 'read', offset: -1 }, exec), /offset/);
    await assert.rejects(definition.execute({ action: 'read' }, { signal: signal() }), /会话/);
    const denied = await rpc('sidebarReader.poll', { clientId: 'c', sessionId: 'session' }, signal(), { principal: { kind: 'guest' } });
    assert.equal(denied.ok, false);
    const owner = { principal: { kind: 'owner' } };
    const poll = rpc('sidebarReader.poll', { clientId: 'c', sessionId: 'session' }, signal(), owner);
    const result = definition.execute({ action: 'read', tab_id: '', script: '', offset: 0, limit: 20000 }, exec);
    const { value: job } = await poll;
    assert.equal(job.limit, 20000);
    await rpc('sidebarReader.complete', { clientId: 'c', id: job.id, result: { title: '文档', text: '正文' } }, signal(), owner);
    assert.equal((await result).text, '正文');
    assert.match(definition.output.render({}, { text: '正文' })[0].text, /外部数据/);
    await assert.rejects(definition.execute({ action: 'execute_js' }, exec), /script/);
    await assert.rejects(definition.execute({ action: 'read', script: '1' }, exec), /script/);
    const scriptPoll = rpc('sidebarReader.poll', { clientId: 'c', sessionId: 'session' }, signal(), owner);
    const scriptResult = definition.execute({ action: 'execute_js', script: 'document.title' }, exec);
    const scriptJob = (await scriptPoll).value;
    assert.equal(scriptJob.script, 'document.title');
    await rpc('sidebarReader.complete', { clientId: 'c', id: scriptJob.id, error: '导航打断' }, signal(), owner);
    await assert.rejects(scriptResult, /操作可能已执行.*不要自动重试/);
  } finally { for (const dispose of disposers) dispose(); }
});
