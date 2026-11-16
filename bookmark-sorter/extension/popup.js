const $ = (id) => document.getElementById(id);
const buttons = ['sort', 'undoLast', 'undoOriginal'].map($);

async function call(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (!res?.ok) throw new Error(res?.error ?? '応答がありません');
  return res.result;
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').className = isError ? 'error' : '';
}

const fmt = (t) => new Date(t).toLocaleString('ja-JP');

function renderPlan(plan) {
  $('source').textContent =
    `対象: ${plan.bar.title}（判定: ${plan.bar.pickedBy}）／ 集計した履歴 URL ${plan.historyUrls} 件・サイト ${plan.hosts} 件` +
    (plan.historyTruncated ? '（上限に達したため履歴の一部しか数えていません）' : '');
  $('summary').textContent =
    plan.folders.length === 0
      ? 'すべて並び済みです'
      : `並びが変わるフォルダ ${plan.folders.length} 個・位置が変わるブックマーク ${plan.moved} 件`;
  $('folders').replaceChildren(
    ...plan.folders.map((f) => {
      const li = document.createElement('li');
      li.textContent = `${f.path}（${f.moved} 件）`;
      return li;
    }),
  );
  return plan.folders.length > 0;
}

async function refresh() {
  buttons.forEach((b) => (b.disabled = true));
  const [plan, status] = await Promise.all([call('preview'), call('status')]);
  const canSort = renderPlan(plan);
  $('sort').disabled = !canSort || status.running;
  $('undoLast').disabled = !status.last || status.running;
  $('undoOriginal').disabled = !status.original || status.running;
  $('undoLast').title = status.last ? `${fmt(status.last.takenAt)} の並び替え前` : '';
  $('undoOriginal').title = status.original ? `${fmt(status.original.takenAt)} より前` : '';
}

async function run(type, label) {
  buttons.forEach((b) => (b.disabled = true));
  setStatus(`${label}中…`);
  try {
    const r = await call(type);
    const warn = r.mismatches.length ? `／ 期待どおりにならなかったフォルダ: ${r.mismatches.join(', ')}` : '';
    setStatus(`${label}完了（移動 ${r.moves} 回）${warn}`, r.mismatches.length > 0);
  } catch (e) {
    setStatus(`${label}に失敗: ${e.message}`, true);
  }
  await refresh().catch((e) => setStatus(e.message, true));
}

$('sort').addEventListener('click', () => run('sort', '並び替え'));
$('undoLast').addEventListener('click', () => run('undoLast', '直前に戻す処理'));
$('undoOriginal').addEventListener('click', () => run('undoOriginal', '初回の前に戻す処理'));
$('openStructure').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('structure.html') });
  window.close();
});

refresh().catch((e) => {
  $('source').textContent = '';
  setStatus(`読み込みに失敗: ${e.message}`, true);
});
