import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { anchorFrom, anchoredPosition } from '../anchoredPanel';
import { Columns3, Check } from 'lucide-react';

/**
 * Multi-select dropdown for choosing exactly which stat columns the table shows.
 *
 * Columns the selected season has no data for are listed but disabled, rather than
 * silently omitted — 2024 never recorded assists or shooting splits, and a checkbox
 * that appears to do nothing is worse than one that explains itself.
 */
export default function ColumnPicker({
    columns, categories, selected, available, onChange, onReset, defaultIds,
}) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState(null);
    const ref = useRef(null);
    const panelRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDocClick = (e) => {
            const inButton = ref.current && ref.current.contains(e.target);
            const inPanel = panelRef.current && panelRef.current.contains(e.target);
            if (!inButton && !inPanel) setOpen(false);
        };
        const onKey = (e) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDocClick);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const toggle = (col) => {
        if (col.locked) return;
        const next = selected.includes(col.id)
            ? selected.filter(id => id !== col.id)
            : [...selected, col.id];
        onChange(next);
    };

    const isDefault =
        selected.length === defaultIds.length && defaultIds.every(id => selected.includes(id));

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={(e) => {
                    // Anchor the panel to the button in viewport coordinates. Rendered
                    // inline it was painted behind the stats table, which sits in its
                    // own stacking context.
                    setAnchor(anchorFrom(e.currentTarget));
                    setOpen(v => !v);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${open
                    ? 'bg-purple-600/20 text-purple-300 border-purple-500/40'
                    : 'bg-[#ffffff05] text-gray-300 border-[#ffffff10] hover:text-white'}`}
            >
                <Columns3 size={15} />
                Columns
                <span className="text-xs text-gray-500">{selected.length}</span>
            </button>

            {open && anchor && createPortal(
                <div
                    ref={panelRef}
                    style={anchoredPosition(anchor, 320)}
                    className="z-[70] w-[min(320px,calc(100vw-16px))] max-h-[70vh] overflow-y-auto rounded-xl
                               bg-[#16161a] border border-white/10 shadow-2xl p-2"
                >
                    <div className="flex items-center justify-between px-2 py-1.5">
                        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                            Show columns
                        </span>
                        <button
                            onClick={onReset}
                            disabled={isDefault}
                            className="text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-600
                                       disabled:cursor-default transition-colors"
                        >
                            Reset to default
                        </button>
                    </div>

                    {categories.map(category => {
                        const inCategory = columns.filter(c => c.cat === category);
                        if (!inCategory.length) return null;
                        return (
                            <div key={category} className="mb-1">
                                <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                                    {category}
                                </div>
                                {inCategory.map(col => {
                                    const checked = selected.includes(col.id);
                                    const hasData = available.has(col.id);
                                    const disabled = col.locked || !hasData;
                                    return (
                                        <button
                                            key={col.id}
                                            onClick={() => toggle(col)}
                                            disabled={disabled}
                                            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm
                                                        transition-colors ${disabled
                                                    ? 'cursor-default'
                                                    : 'hover:bg-[#ffffff08]'}`}
                                        >
                                            <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${checked && hasData
                                                ? 'bg-purple-600 border-purple-500 text-white'
                                                : 'border-white/15'}`}>
                                                {checked && hasData && <Check size={11} strokeWidth={3} />}
                                            </span>
                                            <span className={hasData ? 'text-gray-200' : 'text-gray-600'}>
                                                {col.pickerLabel ?? (typeof col.label === 'function' ? 'Score' : col.label)}
                                            </span>
                                            {col.locked && (
                                                <span className="ml-auto text-[10px] text-gray-600">always</span>
                                            )}
                                            {!hasData && !col.locked && (
                                                <span className="ml-auto text-[10px] text-gray-600">no data</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>,
                document.body
            )}
        </div>
    );
}
