import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { anchorFrom, anchoredPosition } from '../anchoredPanel';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Single-select dropdown for choosing a chart axis.
 *
 * Same portal + viewport-anchoring approach as ColumnPicker: rendered inline these
 * panels are painted behind neighbouring panels, which sit in their own stacking
 * contexts.
 */
export default function AxisPicker({
    label, columns, categories, value, onChange, available, allowNone = false, placeholder = 'Select…',
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

    const nameOf = (col) =>
        col.pickerLabel ?? (typeof col.label === 'function' ? 'Score' : col.label);
    const selected = columns.find(c => c.id === value);

    const choose = (id) => { onChange(id); setOpen(false); };

    return (
        <div className="relative flex flex-col gap-1" ref={ref}>
            <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">{label}</label>
            <button
                onClick={(e) => {
                    setAnchor(anchorFrom(e.currentTarget));
                    setOpen(v => !v);
                }}
                className={`flex items-center justify-between gap-2 min-w-[170px] px-3 py-2 rounded-lg text-sm border
                            transition-colors ${open
                        ? 'bg-purple-600/20 text-purple-200 border-purple-500/40'
                        : 'bg-[#0a0a0c] text-gray-200 border-[#ffffff12] hover:border-white/20'}`}
            >
                <span className={selected ? '' : 'text-gray-500'}>
                    {selected ? nameOf(selected) : placeholder}
                </span>
                <ChevronDown size={14} className="text-gray-500 shrink-0" />
            </button>

            {open && anchor && createPortal(
                <div
                    ref={panelRef}
                    style={anchoredPosition(anchor, 280)}
                    className="z-[70] w-[min(280px,calc(100vw-16px))] max-h-[60vh] overflow-y-auto rounded-xl
                               bg-[#16161a] border border-white/10 shadow-2xl p-2"
                >
                    {allowNone && (
                        <button
                            onClick={() => choose(null)}
                            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm
                                       text-gray-400 hover:bg-[#ffffff08] transition-colors"
                        >
                            <span className="w-4 h-4 shrink-0">
                                {!value && <Check size={12} strokeWidth={3} className="text-purple-400" />}
                            </span>
                            None
                        </button>
                    )}
                    {categories.map(category => {
                        const inCategory = columns.filter(c => c.cat === category);
                        if (!inCategory.length) return null;
                        return (
                            <div key={category}>
                                <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                                    {category}
                                </div>
                                {inCategory.map(col => {
                                    // Offered but disabled when this season never recorded it, so
                                    // an empty option explains itself instead of just failing.
                                    const hasData = !available || available.has(col.id);
                                    return (
                                        <button
                                            key={col.id}
                                            onClick={() => hasData && choose(col.id)}
                                            disabled={!hasData}
                                            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm
                                                        transition-colors ${hasData ? 'hover:bg-[#ffffff08]' : 'cursor-default'}`}
                                        >
                                            <span className="w-4 h-4 shrink-0">
                                                {value === col.id && <Check size={12} strokeWidth={3} className="text-purple-400" />}
                                            </span>
                                            <span className={hasData ? 'text-gray-200' : 'text-gray-600'}>
                                                {nameOf(col)}
                                            </span>
                                            {!hasData && <span className="ml-auto text-[10px] text-gray-600">no data</span>}
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
