import { products } from '@nephoscope/contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Dialog } from '../design/Overlays';
import { Kbd } from '../design/Values';
import { useSession } from '../state/session';
import { useUi } from '../state/ui';
import { productPath } from './products';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Global keyboard shortcuts (SPEC-0001 CA-57, CA-58). Ignored while typing in a field. */
export function Hotkeys() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId;
  const setPalette = useUi((s) => s.setPalette);
  const setShortcuts = useUi((s) => s.setShortcuts);
  const toggleSidebar = useSession((s) => s.toggleSidebar);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (useUi.getState().paletteOpen) return;

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const product = products.find((p) => p.available && p.hotkey === e.key.toLowerCase());
        if (product && projectId) {
          e.preventDefault();
          void navigate({ to: productPath(projectId, product) });
        }
        return;
      }
      switch (e.key) {
        case 'g':
          pendingG.current = window.setTimeout(() => {
            pendingG.current = null;
          }, 1200);
          break;
        case '/': {
          const filter = document.querySelector<HTMLInputElement>('[data-filter-input]');
          if (filter) {
            e.preventDefault();
            filter.focus();
          }
          break;
        }
        case '?':
          e.preventDefault();
          setShortcuts(true);
          break;
        case '[':
          e.preventDefault();
          toggleSidebar();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, projectId, setPalette, setShortcuts, toggleSidebar]);

  return null;
}

const SHORTCUTS: [string[], string][] = [
  [['Ctrl', 'K'], 'Open the command palette'],
  [['/'], 'Focus the filter of the current list'],
  [['j'], 'Move down in a list'],
  [['k'], 'Move up in a list'],
  [['Enter'], 'Open the selected row'],
  [['x'], 'Select the current row'],
  [['['], 'Collapse or expand the product index'],
  [['?'], 'Show this sheet'],
];

export function ShortcutSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcuts);
  const goKeys = products.filter((p) => p.available && p.hotkey);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" width="md">
      <table className="w-full border-collapse text-dense">
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={what} className="border-b border-rule last:border-b-0">
              <td className="w-40 py-1.5">
                <span className="flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </td>
              <td className="py-1.5 text-ink">{what}</td>
            </tr>
          ))}
          {goKeys.map((p) => (
            <tr key={p.id} className="border-b border-rule last:border-b-0">
              <td className="w-40 py-1.5">
                <span className="flex gap-1">
                  <Kbd>g</Kbd>
                  <Kbd>{p.hotkey}</Kbd>
                </span>
              </td>
              <td className="py-1.5 text-ink">Go to {p.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
