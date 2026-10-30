import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Pagination } from '@astryxdesign/core/Pagination';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Table, pixel, proportional, useTableSelection, useTableSortable, type TableColumn } from '@astryxdesign/core/Table';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { FileText, FolderOpen, Image as ImageIcon, MoreHorizontal, Play, RefreshCw, Trash2 } from 'lucide-react';
import { call, isDesktop, logEvent } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatCallError, formatDateTime } from '../../shared/i18n/format';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { formatBytes, formatTime, type Asset, type AssetKind, type AssetResult, type State, type Track } from '../../shared/workbench';
import { Player } from '../media/player';

const pageSize = 50;
const kinds: AssetKind[] = ['generation', 'segment', 'voice', 'material', 'image'];
type SortKey = 'createdAt' | 'bytes' | 'duration' | 'name';
interface Row extends Record<string, unknown> { key: string; asset: Asset }

const rowKey = (a: Asset) => `${a.kind}:${a.id}`;
const isUsed = (a: Asset) => (a.users?.length ?? 0) > 0;
// 时间轴素材属于作品草稿，只能在作品的时间轴里移除；正在被引用的也不能勾选。
const canDelete = (a: Asset) => a.kind !== 'material' && !isUsed(a);

/**
 * 设置里的资源页：汇总所有生成音频、故事配音片段、参考音频、时间轴素材和 AI 图片，
 * 按类型、作品、使用情况和关键词筛选，可排序、试听或预览，并批量删除未被使用的项目。
 */
export function AssetsPage({ state, active, run, onError, openProject }: {
  state: State; active: boolean; run: (task: () => Promise<unknown>) => void; onError: (error: string) => void;
  openProject: (id: string) => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState('');
  const [project, setProject] = useState('');
  const [usage, setUsage] = useState('');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<{ sortKey: SortKey; direction: 'ascending' | 'descending' }[]>([{ sortKey: 'createdAt', direction: 'descending' }]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 删除失败的原因显示在确认框里，不弹全局通知。
  const [deleteError, setDeleteError] = useState('');
  const confirm = () => { setDeleteError(''); setConfirming(true); };
  const [outcome, setOutcome] = useState<{ deleted: number; freed: number; failed: { asset: Asset; result: AssetResult }[] } | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [image, setImage] = useState<{ name: string; src: string } | null>(null);

  const load = useCallback(() => run(async () => {
    setLoading(true);
    try { setAssets(await call<Asset[]>('assets.list') ?? []); } finally { setLoading(false); }
  }), [run]);
  // 进入页面时读取；生成、删除或导入改变了资源列表时重新汇总（文件大小只有后端知道）。
  // 只看 id 和作品名的变化：编辑正文触发的自动保存不会反复拉取整张列表。
  const revision = useMemo(() => JSON.stringify([state.history.map(g => g.id), state.voices.map(v => v.id), state.drafts.map(d => [d.id, d.title, ...(d.timeline?.assets ?? []).map(a => a.id)])]), [state.history, state.voices, state.drafts]);
  useEffect(() => { if (active) load(); }, [active, load, revision]);
  // 列表刷新后去掉已不存在的勾选项。
  useEffect(() => setSelected(current => new Set([...current].filter(key => assets.some(a => rowKey(a) === key && canDelete(a))))), [assets]);

  const totals = useMemo(() => {
    const byKind = new Map<AssetKind, { count: number; bytes: number }>();
    for (const a of assets) {
      const entry = byKind.get(a.kind) ?? { count: 0, bytes: 0 };
      entry.count++; entry.bytes += Math.max(a.bytes, 0);
      byKind.set(a.kind, entry);
    }
    return { byKind, bytes: [...byKind.values()].reduce((sum, v) => sum + v.bytes, 0) };
  }, [assets]);
  const projects = useMemo(() => [...new Map(assets.filter(a => a.projectId).map(a => [a.projectId!, a.projectTitle ?? ''])).entries()], [assets]);

  const filtered = useMemo(() => {
    const query = text.trim().toLocaleLowerCase();
    const list = assets.filter(a => (!kind || a.kind === kind)
      && (!project || (project === '-' ? a.projectId && !a.projectTitle : a.projectId === project))
      && (!usage || (usage === 'used') === isUsed(a))
      && (!query || [a.name, a.projectTitle ?? '', ...(a.users ?? [])].some(v => v.toLocaleLowerCase().includes(query))));
    const [{ sortKey, direction } = { sortKey: 'createdAt' as SortKey, direction: 'descending' as const }] = sort;
    const value = (a: Asset) => sortKey === 'name' ? a.name : sortKey === 'createdAt' ? a.createdAt : sortKey === 'bytes' ? a.bytes : a.duration ?? 0;
    return [...list].sort((a, b) => {
      const x = value(a), y = value(b);
      const order = typeof x === 'string' ? x.localeCompare(String(y), locale) : x - Number(y);
      return direction === 'ascending' ? order : -order;
    });
  }, [assets, kind, project, usage, text, sort, locale]);
  // 删除或筛选后列表变短时，页码收敛到最后一页。
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows: Row[] = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(asset => ({ key: rowKey(asset), asset }));
  const deletable = filtered.filter(canDelete);
  const picked = assets.filter(a => selected.has(rowKey(a)));
  const pickedBytes = picked.reduce((sum, a) => sum + Math.max(a.bytes, 0), 0);
  const filter = (set: (value: string) => void) => (value: string) => { set(value); setPage(1); };

  const selection = useTableSelection<Row>({
    getIsItemSelected: row => selected.has(row.key),
    onSelectItem: ({ item, isSelected }) => setSelected(current => { const next = new Set(current); if (isSelected) next.add(item.key); else next.delete(item.key); return next; }),
    onSelectAll: ({ isAllSelected }) => setSelected(isAllSelected ? new Set(deletable.map(rowKey)) : new Set()),
    getIsAllSelected: () => deletable.length > 0 && deletable.every(a => selected.has(rowKey(a))),
    getIsIndeterminate: () => selected.size > 0 && !deletable.every(a => selected.has(rowKey(a))),
    getIsItemEnabled: row => canDelete(row.asset),
    getRowLabel: row => row.asset.name,
  });
  const sortable = useTableSortable<Row, SortKey>({ sort, onSortChange: next => { setSort(next as typeof sort); setPage(1); } });

  const kindLabel = (value: AssetKind) => t(`@yovoice.assets.kind.${value}`);
  const time = (value: string) => value && !value.startsWith('0001') ? formatDateTime(value, locale) : '—';
  const listen = (a: Asset) => setTrack({ id: a.id, name: a.name, fileName: a.fileName, kind: a.media === 'voices' ? 'voices' : 'outputs', subtitle: kindLabel(a.kind), playRequest: performance.now() });
  const preview = (a: Asset) => run(async () => setImage({ name: a.name, src: await call<string>('assets.image', { id: a.id }) }));
  const columns: TableColumn<Row>[] = [
    { key: 'name', header: t('@yovoice.assets.col.name'), width: proportional(1), sortable: true, renderCell: ({ asset: a }) => <HStack gap={2} vAlign="center">
      {a.kind === 'image'
        ? <Button size="sm" variant="ghost" isIconOnly icon={<ImageIcon size={15} />} label={t('@yovoice.assets.preview', { name: a.name })} isDisabled={a.bytes < 0} onClick={() => preview(a)} />
        : <Button size="sm" variant="ghost" isIconOnly icon={<Play size={15} />} label={t('@yovoice.assets.play', { name: a.name })} isDisabled={a.bytes < 0} onClick={() => listen(a)} />}
      <small className="asset-name" title={a.projectTitle ? `${a.name} · ${a.projectTitle}` : a.name}>{a.name}</small>
    </HStack> },
    { key: 'kind', header: t('@yovoice.assets.col.kind'), width: pixel(96), align: 'center', renderCell: ({ asset: a }) => <Token size="sm" color={a.kind === 'voice' ? 'teal' : a.kind === 'image' ? 'purple' : a.kind === 'material' ? 'orange' : 'default'} label={kindLabel(a.kind)} /> },
    { key: 'duration', header: t('@yovoice.assets.col.duration'), width: pixel(64), align: 'center', sortable: true, renderCell: ({ asset: a }) => <small>{a.duration ? formatTime(a.duration) : '—'}</small> },
    { key: 'bytes', header: t('@yovoice.assets.col.size'), width: pixel(84), align: 'center', sortable: true, renderCell: ({ asset: a }) => <small>{a.bytes < 0 ? '—' : formatBytes(a.bytes)}</small> },
    { key: 'createdAt', header: t('@yovoice.assets.col.created'), width: pixel(128), align: 'center', sortable: true, renderCell: ({ asset: a }) => <small>{time(a.createdAt)}</small> },
    // 状态只写短词，引用它的角色或作品放进悬停提示，避免撑宽表格。
    { key: 'status', header: t('@yovoice.assets.col.status'), width: pixel(92), align: 'center', renderCell: ({ asset: a }) => {
      const [variant, label, tooltip] = a.bytes < 0 ? ['error', t('@yovoice.assets.status.missing'), undefined] as const
        : isUsed(a) ? ['warning', t('@yovoice.assets.status.used'), t('@yovoice.assets.status.usedBy', { names: a.users!.join('、') })] as const
          : ['neutral', t('@yovoice.assets.status.unused'), undefined] as const;
      return <HStack gap={2} vAlign="center" hAlign="center"><StatusDot variant={variant} label={tooltip ?? label} tooltip={tooltip} /><small title={tooltip}>{label}</small></HStack>;
    } },
    // 所属作品、打开位置和删除收进“更多”菜单，表格在设置页宽度内一屏放下。
    { key: 'actions', header: '', width: pixel(56), align: 'center', renderCell: ({ asset: a }) => {
      const items = [
        ...(a.projectId && a.projectTitle ? [{ id: 'project', label: t('@yovoice.assets.openProject', { name: a.projectTitle }), icon: <FileText size={16} strokeWidth={1.5} />, onClick: () => openProject(a.projectId!) }] : []),
        ...(isDesktop && a.media !== 'images' && a.bytes >= 0 ? [{ id: 'reveal', label: t('@yovoice.assets.reveal'), icon: <FolderOpen size={16} strokeWidth={1.5} />,
          onClick: () => { void call('media.reveal', { kind: a.media, id: a.id }).catch(e => onError(noticeMessage(e))); } }] : []),
        ...(canDelete(a) ? [{ id: 'delete', label: t('@yovoice.assets.delete'), icon: <Trash2 size={16} strokeWidth={1.5} />, variant: 'destructive' as const,
          onClick: () => { setSelected(new Set([rowKey(a)])); confirm(); } }] : []),
      ];
      return items.length ? <DropdownMenu presentation="popover" alignment="end" hasChevron={false} menuWidth="max-content" items={items}
        button={{ size: 'sm', variant: 'ghost', isIconOnly: true, icon: <MoreHorizontal size={15} />, label: t('@yovoice.assets.more', { name: a.name }) }} /> : null;
    } },
  ];

  const remove = async () => {
    setDeleting(true); setDeleteError('');
    try {
      const items = picked.map(a => ({ kind: a.kind, id: a.id }));
      const results = await call<AssetResult[]>('assets.delete', { items });
      const byKey = new Map(picked.map(a => [rowKey(a), a]));
      // 服务端只会返回请求过的项；万一对不上，跳过并记日志，不让整页崩掉。
      const resolve = (r: AssetResult) => { const asset = byKey.get(`${r.kind}:${r.id}`); if (!asset) logEvent('assets_delete_unmatched', `${r.kind}:${r.id}`); return asset; };
      const failed = results.flatMap(result => { const asset = result.error ? resolve(result) : undefined; return asset ? [{ asset, result }] : []; });
      const done = results.flatMap(r => { const asset = r.error ? undefined : resolve(r); return asset ? [asset] : []; });
      setOutcome({ deleted: done.length, freed: done.reduce((sum, a) => sum + Math.max(a.bytes, 0), 0), failed });
      setShowFailures(failed.length > 0);
      if (track && done.some(a => a.id === track.id)) setTrack(null);
      setSelected(new Set()); setConfirming(false);
      load();
    } catch (e) { setDeleteError(formatCallError(t, e)); }
    finally { setDeleting(false); }
  };

  // 一行工具栏：搜索与筛选在左，合计与刷新在右；表格区域自己滚动，表头、分页和试听条固定。
  return <VStack className="settings-panel assets-page" gap={3} data-testid="assets-page" id="assets-panel" role="tabpanel" aria-label={t('@yovoice.nav.assets')}>
    <HStack className="asset-toolbar" gap={2} vAlign="center" wrap="wrap">
      <TextInput size="sm" label={t('@yovoice.assets.search')} isLabelHidden value={text} onChange={filter(setText)} placeholder={t('@yovoice.assets.searchPlaceholder')} width="calc(var(--spacing-10) * 5)" />
      <Selector size="sm" label={t('@yovoice.assets.col.kind')} isLabelHidden value={kind} onChange={filter(setKind)} width="calc(var(--spacing-10) * 3.5)"
        options={[{ value: '', label: t('@yovoice.assets.allKinds') }, ...kinds.map(value => ({ value, label: totals.byKind.has(value) ? `${kindLabel(value)} · ${totals.byKind.get(value)!.count}` : kindLabel(value) }))]} />
      <Selector size="sm" label={t('@yovoice.assets.col.project')} isLabelHidden value={project} onChange={filter(setProject)} width="calc(var(--spacing-10) * 4)"
        options={[{ value: '', label: t('@yovoice.assets.allProjects') }, ...projects.filter(([, title]) => title).map(([value, label]) => ({ value, label })), ...(projects.some(([, title]) => !title) ? [{ value: '-', label: t('@yovoice.assets.sourceMissing') }] : [])]} />
      <Selector size="sm" label={t('@yovoice.assets.usage')} isLabelHidden value={usage} onChange={filter(setUsage)} width="calc(var(--spacing-10) * 3)"
        options={[{ value: '', label: t('@yovoice.assets.usage.all') }, { value: 'unused', label: t('@yovoice.assets.status.unused') }, { value: 'used', label: t('@yovoice.assets.status.used') }]} />
      <HStack className="grow" hAlign="end" vAlign="center" gap={1}>
        {selected.size > 0 ? <>
          <Button size="sm" variant="ghost" label={t('@yovoice.assets.clearSelection')} onClick={() => setSelected(new Set())} />
          <Button size="sm" variant="destructive" icon={<Trash2 size={15} />} label={t('@yovoice.assets.deleteSelected')} onClick={confirm} />
        </> : <>
          {outcome ? <small className="asset-muted" role="status">{t('@yovoice.assets.deleted', { count: outcome.deleted, size: formatBytes(outcome.freed) })}
            {outcome.failed.length ? <> {t('@yovoice.assets.skipped', { count: outcome.failed.length })} <Button size="sm" variant="ghost" label={t('@yovoice.assets.showSkipped')} onClick={() => setShowFailures(true)} /></> : null}</small>
            : <small className="asset-muted" title={t('@yovoice.assets.hint')}>{t('@yovoice.assets.total', { count: assets.length, size: formatBytes(totals.bytes) })}</small>}
          <Button size="sm" variant="ghost" isIconOnly label={t('@yovoice.logs.refresh')} icon={<RefreshCw size={15} />} isLoading={loading} onClick={load} />
        </>}
      </HStack>
    </HStack>
    <VStack className="asset-table" gap={0}>
      <Table<Row> data={pageRows} columns={columns} idKey="key" density="compact" textOverflow="truncate" hasHover plugins={{ selection, sortable }}
        emptyState={loading ? false : <EmptyState title={t(assets.length ? '@yovoice.assets.noMatch' : '@yovoice.assets.empty')} />} />
    </VStack>
    {filtered.length > pageSize ? <Pagination size="sm" variant="count" page={currentPage} pageSize={pageSize} totalItems={filtered.length} onChange={setPage} label={t('@yovoice.assets.pages')} /> : null}
    {track ? <Player track={track} suspended={!active} onError={onError} reveal={false} /> : null}

    {confirming ? <AppDialog title={t('@yovoice.assets.deleteTitle', { count: picked.length })} busy={deleting} error={deleteError} onClose={() => setConfirming(false)}
      actions={<><Button label={t('@yovoice.action.cancel')} isDisabled={deleting} onClick={() => setConfirming(false)} /><Button variant="destructive" label={t('@yovoice.assets.deleteConfirm')} isLoading={deleting} onClick={() => void remove()} /></>}>
      <p>{t('@yovoice.assets.deleteBody', { size: formatBytes(pickedBytes) })}</p>
    </AppDialog> : null}
    {showFailures && outcome ? <AppDialog title={t('@yovoice.assets.skippedTitle')} onClose={() => setShowFailures(false)}
      actions={<Button variant="primary" label={t('@yovoice.action.close')} onClick={() => setShowFailures(false)} />}>
      <VStack as="ul" className="asset-failures" gap={2}>{outcome.failed.map(({ asset, result }) => <li key={rowKey(asset)}><strong>{asset.name}</strong> — {formatCallError(t, { errorCode: result.error, errorParams: result.params })}</li>)}</VStack>
    </AppDialog> : null}
    {image ? <AppDialog title={image.name} width={720} onClose={() => setImage(null)} actions={<Button variant="primary" label={t('@yovoice.action.close')} onClick={() => setImage(null)} />}>
      <img className="asset-image" src={image.src} alt={image.name} />
    </AppDialog> : null}
  </VStack>;
}
