import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ColumnsIcon } from '@phosphor-icons/react';
import {
  createColumnHelper,
  createSortedRowModel,
  type Row,
  rowSortingFeature,
  type SortFn,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type TableComponents, TableVirtuoso, type TableVirtuosoHandle } from 'react-virtuoso';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { EmptyState } from './Feedback';
import { useScrollParent } from './ScrollParent';

export interface ResourceColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables sorting on the loaded rows. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** CSS width of the column, such as "8rem". Columns without a width share the rest. */
  width?: string;
  align?: 'left' | 'right';
  /** Key columns cannot be hidden. */
  hideable?: boolean;
  defaultHidden?: boolean;
}

interface ResourceTableProps<T> {
  /** Stable id used to remember column visibility (SPEC-0001 CA-62). */
  tableId: string;
  label: string;
  rows: T[];
  columns: ResourceColumn<T>[];
  getRowId: (row: T) => string;
  onOpen?: (row: T) => void;
  /** Shows an item column, numbered like a parts list (SPEC-0002 D-17). */
  itemColumn?: boolean;
  selectable?: boolean;
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  /** True when rows are filtered, so the empty state says "no match" rather than "none exist". */
  filtered?: boolean;
  emptyTitle: string;
  emptyText?: ReactNode;
  emptyAction?: ReactNode;
  noMatchAction?: ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  rowClassName?: (row: T) => string | undefined;
  toolbar?: ReactNode;
}

// biome-ignore lint/suspicious/noExplicitAny: a sort function shared by tables of every row type.
const naturalSort: SortFn<any, any> = (a, b, columnId) => {
  const x = a.getValue(columnId) as string | number | null | undefined;
  const y = b.getValue(columnId) as string | number | null | undefined;
  if (x === y) return 0;
  if (x === null || x === undefined || x === '') return 1;
  if (y === null || y === undefined || y === '') return -1;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
};

const CONTROLS = 'a, button, input, textarea, select, [role="menuitem"], [role="checkbox"]';

/** True when the event came from a control between the target and `boundary`. */
function isControl(target: Element, boundary: Element): boolean {
  const hit = target.closest(CONTROLS);
  return hit !== null && hit !== boundary && boundary.contains(hit);
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { natural: naturalSort },
});

// biome-ignore lint/suspicious/noExplicitAny: the Virtuoso context is shared by tables of every row type.
type AnyRow = Row<typeof features, any>;

interface VirtuosoContext {
  label: string;
  rows: AnyRow[];
  active: number;
  setActive: (index: number) => void;
  onOpen?: (row: unknown) => void;
  selection?: ReadonlySet<string>;
  selectable?: boolean;
  rowClassName?: (row: unknown) => string | undefined;
}

const VTable = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement> & { context?: VirtuosoContext }>(function VTable(
  { context, style, ...props },
  ref,
) {
  return (
    <table
      ref={ref}
      {...props}
      aria-label={context?.label}
      className="w-full border-collapse text-dense"
      style={{ ...style, tableLayout: 'fixed' }}
    />
  );
});

const VHead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function VHead(props, ref) {
  return <thead ref={ref} {...props} className="z-10" />;
});

function VRow({ item: _item, context, ...props }: HTMLAttributes<HTMLTableRowElement> & { item: AnyRow; context?: VirtuosoContext }) {
  const index = Number((props as { 'data-index'?: number })['data-index']);
  const row = context?.rows[index];
  const selected = row ? context?.selection?.has(row.id) : false;
  return (
    <tr
      {...props}
      data-active={index === context?.active || undefined}
      aria-selected={context?.selectable ? selected : undefined}
      onClick={(e) => {
        // Controls inside a cell act on their own; clicks from portals (dialogs a cell opened) are not the row's.
        if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target) || isControl(e.target, e.currentTarget)) return;
        context?.setActive(index);
        if (row && context?.onOpen) context.onOpen(row.original);
      }}
      className={cn(
        'h-(--row-h) hover:bg-hover data-[active]:bg-construct-tint',
        context?.onOpen && 'cursor-pointer',
        selected && 'bg-construct-tint',
        row && context?.rowClassName?.(row.original),
      )}
    />
  );
}

const components: TableComponents<AnyRow, VirtuosoContext> = {
  Table: VTable,
  TableHead: VHead,
  TableRow: VRow,
};

function readHidden(tableId: string, columns: { id: string; defaultHidden?: boolean }[]): Set<string> {
  try {
    const raw = localStorage.getItem(`nephoscope.cols.${tableId}`);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* Fall back to the column defaults. */
  }
  return new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
}

/**
 * The shared list table (SPEC-0001 CA-62, SPEC-0002 CA-19): real table semantics, virtualized,
 * sortable, keyboard navigable, with distinct empty states and paging by "load more".
 */
// biome-ignore lint/suspicious/noExplicitAny: matches TanStack Table's RowData constraint.
export function ResourceTable<T extends Record<string, any>>({
  tableId,
  label,
  rows,
  columns,
  getRowId,
  onOpen,
  itemColumn,
  selectable,
  selection,
  onSelectionChange,
  filtered,
  emptyTitle,
  emptyText,
  emptyAction,
  noMatchAction,
  hasMore,
  loadingMore,
  onLoadMore,
  rowClassName,
  toolbar,
}: ResourceTableProps<T>) {
  const scrollParent = useScrollParent();
  const virtuoso = useRef<TableVirtuosoHandle>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(tableId, columns));
  const [active, setActive] = useState(-1);

  useEffect(() => {
    try {
      localStorage.setItem(`nephoscope.cols.${tableId}`, JSON.stringify([...hidden]));
    } catch {
      /* Not critical. */
    }
  }, [hidden, tableId]);

  const visibleColumns = useMemo(() => columns.filter((c) => c.hideable === false || !hidden.has(c.id)), [columns, hidden]);
  const columnById = useMemo(() => new Map(visibleColumns.map((c) => [c.id, c])), [visibleColumns]);

  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return visibleColumns.map((c) =>
      helper.accessor((row: T): unknown => c.sortValue?.(row) ?? null, {
        id: c.id,
        header: c.header,
        enableSorting: !!c.sortValue,
        sortFn: 'natural',
      }),
    );
  }, [visibleColumns]);

  const table = useTable(
    {
      features,
      columns: tableColumns,
      data: rows,
      getRowId: (row: T) => getRowId(row),
      state: { sorting },
      onSortingChange: (updater) => setSorting((prev) => (typeof updater === 'function' ? updater(prev) : updater)),
    },
    (state) => ({ sorting: state.sorting }),
  );

  const modelRows = table.getRowModel().rows as AnyRow[];

  const toggleRow = useCallback(
    (id: string) => {
      if (!onSelectionChange) return;
      const next = new Set(selection ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selection, onSelectionChange],
  );

  const context = useMemo<VirtuosoContext>(
    () => ({
      label,
      rows: modelRows,
      active,
      setActive,
      onOpen: onOpen as ((row: unknown) => void) | undefined,
      selection,
      selectable,
      rowClassName: rowClassName as ((row: unknown) => string | undefined) | undefined,
    }),
    [label, modelRows, active, onOpen, selection, selectable, rowClassName],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && isControl(e.target, e.currentTarget)) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(active + 1, modelRows.length - 1);
      setActive(next);
      virtuoso.current?.scrollIntoView({ index: next });
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(active - 1, 0);
      setActive(next);
      virtuoso.current?.scrollIntoView({ index: next });
    } else if (e.key === 'Enter' && active >= 0) {
      const row = modelRows[active];
      if (row && onOpen) onOpen(row.original as T);
    } else if (e.key === 'x' && active >= 0 && selectable) {
      const row = modelRows[active];
      if (row) toggleRow(row.id);
    }
  };

  const hideable = columns.filter((c) => c.hideable !== false);
  const allSelected = !!selectable && modelRows.length > 0 && modelRows.every((r) => selection?.has(r.id));

  const toolbarRow =
    toolbar || hideable.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
        {toolbar}
        {hideable.length > 0 && rows.length > 0 ? (
          <BaseMenu.Root>
            <BaseMenu.Trigger render={<Button size="sm" variant="ghost" icon={ColumnsIcon} className="ml-auto" />}>
              Columns
            </BaseMenu.Trigger>
            <BaseMenu.Portal>
              <BaseMenu.Positioner align="end" sideOffset={4} className="z-50 outline-none">
                <BaseMenu.Popup className="nb-popup min-w-48 rounded-menu border border-rule-strong bg-sheet p-1 text-dense shadow-overlay outline-none">
                  {hideable.map((c) => (
                    <BaseMenu.CheckboxItem
                      key={c.id}
                      checked={!hidden.has(c.id)}
                      onCheckedChange={(checked) =>
                        setHidden((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      closeOnClick={false}
                      className="grid h-8 cursor-default grid-cols-[16px_1fr] items-center gap-2 rounded-control px-2 text-ink outline-none select-none data-[highlighted]:bg-hover"
                    >
                      <BaseMenu.CheckboxItemIndicator className="col-start-1">
                        <CheckIcon size={14} aria-hidden />
                      </BaseMenu.CheckboxItemIndicator>
                      <span className="col-start-2">{c.header}</span>
                    </BaseMenu.CheckboxItem>
                  ))}
                </BaseMenu.Popup>
              </BaseMenu.Positioner>
            </BaseMenu.Portal>
          </BaseMenu.Root>
        ) : null}
      </div>
    ) : null;

  if (rows.length === 0) {
    return (
      <div>
        {toolbarRow}
        {filtered ? (
          <EmptyState title="Nothing matches the filter" action={noMatchAction}>
            Change or clear the filter to see more.
          </EmptyState>
        ) : (
          <EmptyState title={emptyTitle} action={emptyAction}>
            {emptyText}
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div>
      {toolbarRow}
      <div
        role="group"
        aria-label={`${label}. Use j and k to move, Enter to open.`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the list takes focus for j/k/x/Enter; rows report selection with aria-selected.
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          if (e.target === e.currentTarget && active < 0 && modelRows.length > 0) setActive(0);
        }}
        className="outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <TableVirtuoso
          ref={virtuoso}
          data={modelRows}
          context={context}
          components={components}
          customScrollParent={scrollParent ?? undefined}
          useWindowScroll={!scrollParent}
          increaseViewportBy={{ top: 400, bottom: 800 }}
          computeItemKey={(_i, row) => row.id}
          endReached={() => {
            if (hasMore && !loadingMore) onLoadMore?.();
          }}
          fixedHeaderContent={() => (
            <tr className="bg-film">
              {selectable ? (
                <th scope="col" className="w-10 border-b border-rule-strong pl-6 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={(e) => onSelectionChange?.(e.target.checked ? new Set(modelRows.map((r) => r.id)) : new Set())}
                  />
                </th>
              ) : null}
              {itemColumn ? (
                <th scope="col" className="w-14 border-b border-rule-strong pl-6 text-left font-normal">
                  <span className="legend">Item</span>
                </th>
              ) : null}
              {table.getHeaderGroups()[0]?.headers.map((header, i) => {
                const col = columnById.get(header.column.id);
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                    style={{ width: col?.width }}
                    className={cn(
                      'h-8 border-b border-rule-strong px-3 font-normal',
                      i === 0 && !selectable && !itemColumn && 'pl-6',
                      col?.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn('legend inline-flex items-center gap-1 hover:text-ink', sorted && 'text-ink')}
                      >
                        {col?.header}
                        {sorted === 'asc' ? (
                          <ArrowUpIcon size={11} aria-hidden />
                        ) : sorted === 'desc' ? (
                          <ArrowDownIcon size={11} aria-hidden />
                        ) : null}
                      </button>
                    ) : (
                      <span className="legend">{col?.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          )}
          itemContent={(index, row) => (
            <>
              {selectable ? (
                // biome-ignore lint/a11y/useKeyWithClickEvents: only keeps a click on the checkbox from opening the row.
                <td className="border-b border-rule pl-6" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={selection?.has(row.id) ?? false}
                    onChange={() => toggleRow(row.id)}
                  />
                </td>
              ) : null}
              {itemColumn ? <td className="tnum border-b border-rule pl-6 font-mono text-[11px] text-ink-3">{index + 1}</td> : null}
              {row.getAllCells().map((cell, i) => {
                const col = columnById.get(cell.column.id);
                return (
                  <td
                    key={cell.id}
                    className={cn(
                      'truncate border-b border-rule px-3',
                      i === 0 && !selectable && !itemColumn && 'pl-6',
                      col?.align === 'right' && 'tnum text-right',
                    )}
                  >
                    {col?.cell(row.original as T)}
                  </td>
                );
              })}
            </>
          )}
        />
      </div>
      {hasMore ? (
        <div className="flex justify-center px-6 py-3">
          <Button size="sm" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
