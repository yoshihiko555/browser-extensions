const $ = (id) => document.getElementById(id);
let plan = null;
let busy = false;

async function call(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error ?? '応答がありません');
  return res.result;
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').className = isError ? 'error' : '';
}

function render(r) {
  const s = r.stats;
  $('result').hidden = false;
  $('summary').textContent =
    `フォルダ作成 ${s.create}・フォルダ移動 ${s.folderMoves}・名前変更 ${s.renames}・ブックマーク移動 ${s.moves}・` +
    `フォルダの並び調整 ${s.reorders}（反映済み ${s.already}）`;
  $('errors').replaceChildren(
    ...r.errors.map((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      return li;
    }),
  );
  $('outline').textContent = r.outline.map((f) => `${'    '.repeat(f.depth)}${f.title}（${f.bookmarks}）`).join('\n');
}

async function refresh({ announce = true } = {}) {
  const status = await call('status');
  let preview = null;
  if (plan) {
    preview = await call('structurePreview', { plan });
    render(preview);
  }
  $('apply').disabled = busy || status.running || !preview || preview.errors.length > 0 || preview.operations === 0;
  $('undo').disabled = busy || status.running || !status.structure;
  if (!announce) return;
  if (preview?.errors.length) setStatus('食い違いがあるため反映できません。何も変更していません。', true);
  else if (preview && preview.operations === 0) setStatus('すべて反映済みです。');
}

async function run(type, label, extra) {
  busy = true;
  $('apply').disabled = $('undo').disabled = true;
  setStatus(`${label}中…`);
  try {
    const r = await call(type, extra);
    if (type === 'structureApply') {
      if (!r.applied) setStatus(r.errors.length ? '食い違いがあるため反映しませんでした。' : '変更はありませんでした。', r.errors.length > 0);
      else setStatus(r.matches ? '反映完了' : '反映しましたが、結果が想定と一致しません', !r.matches);
    } else {
      const notes = [];
      if (r.missing) notes.push(`見つからない項目 ${r.missing} 件`);
      if (r.leftovers.length) notes.push(`空でないため残したフォルダ: ${r.leftovers.join(', ')}`);
      if (r.mismatched.length) notes.push(`元の位置に戻らなかった項目 ${r.mismatched.length} 件`);
      setStatus(`元に戻す処理完了${notes.length ? `（${notes.join('／')}）` : ''}`, r.mismatched.length > 0);
    }
  } catch (e) {
    setStatus(`${label}に失敗: ${e.message}`, true);
  }
  busy = false;
  await refresh({ announce: false }).catch((e) => setStatus(e.message, true));
}

$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    plan = JSON.parse(await file.text());
    setStatus('');
    await refresh();
  } catch (e) {
    plan = null;
    $('result').hidden = true;
    setStatus(`構成ファイルを読めません: ${e.message}`, true);
  }
});
$('apply').addEventListener('click', () => run('structureApply', '反映', { plan }));
$('undo').addEventListener('click', () => run('structureUndo', '元に戻す処理'));

refresh().catch((e) => setStatus(e.message, true));
