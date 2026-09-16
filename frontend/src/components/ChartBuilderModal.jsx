import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { COLUMNS, COLUMN_CATEGORIES, columnLabel } from '../columns';
import AxisPicker from './AxisPicker';
import ChartCanvas, { LayerBar } from './charts/ChartCanvas';

const colById = (id) => COLUMNS.find(c => c.id === id);

const EMPTY = {
    x: null, y: null, title: '',
    layers: { colorBy: false, quadrants: false, labels: false, sizeBy: null },
};

/**
 * Build a chart and see it before committing to it.
 *
 * The preview is rendered by the same ChartCanvas that draws saved charts, so
 * there is no chance of the preview and the result disagreeing.
 */
export default function ChartBuilderModal({
    rows, available, scoreMetric, sizeOptions, axisCandidates, onSave, onClose,
}) {
    const [draft, setDraft] = useState(EMPTY);

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const x = colById(draft.x);
    const y = colById(draft.y);
    const bothCategorical = x?.axis === 'category' && y?.axis === 'category';
    const ready = x && y && !bothCategorical;

    const labelFor = (col) => columnLabel(col, true, scoreMetric);
    const autoTitle = ready ? `${labelFor(y)} vs ${labelFor(x)}` : '';

    const save = () => {
        if (!ready) return;
        onSave({
            title: draft.title.trim() || autoTitle,
            x: x.id,
            y: y.id,
            layers: draft.layers,
        });
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6"
            onClick={onClose}
        >
            <div
                className="glass-panel w-full max-w-4xl my-8 p-6 space-y-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white">New chart</h2>
                        <p className="text-sm text-gray-400">
                            Pick two metrics — a category on either axis gives a bar chart.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#ffffff08] transition-colors"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                    <AxisPicker
                        label="X axis"
                        columns={axisCandidates}
                        categories={COLUMN_CATEGORIES}
                        value={draft.x}
                        available={available}
                        onChange={(id) => setDraft(d => ({ ...d, x: id }))}
                    />
                    <AxisPicker
                        label="Y axis"
                        columns={axisCandidates}
                        categories={COLUMN_CATEGORIES}
                        value={draft.y}
                        available={available}
                        onChange={(id) => setDraft(d => ({ ...d, y: id }))}
                    />
                    <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                            Title <span className="normal-case tracking-normal text-gray-600">(optional)</span>
                        </label>
                        <input
                            type="text"
                            value={draft.title}
                            placeholder={autoTitle || 'Named automatically'}
                            onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))}
                            className="input-dark bg-[#0a0a0c] w-full"
                        />
                    </div>
                </div>

                {bothCategorical && (
                    <p className="text-xs text-amber-400/80">
                        Two categories can’t be plotted against each other — pick a metric for one axis.
                    </p>
                )}

                {/* Live preview, drawn by the same component that renders saved charts. */}
                <div className="rounded-xl border border-white/5 bg-[#ffffff03] p-4">
                    {ready ? (
                        <>
                            <h3 className="font-semibold text-gray-100 mb-1">
                                {draft.title.trim() || autoTitle}
                            </h3>
                            <p className="text-xs text-gray-500 mb-3">Preview</p>
                            <ChartCanvas
                                chart={{ ...draft, x: x.id, y: y.id }}
                                rows={rows}
                                available={available}
                                scoreMetric={scoreMetric}
                                showLayers
                                sizeOptions={sizeOptions}
                                onChange={(updated) => setDraft(d => ({ ...d, layers: updated.layers }))}
                            />
                        </>
                    ) : (
                        <div className="h-[280px] flex items-center justify-center text-sm text-gray-500">
                            Choose both axes to see a preview.
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white
                                   hover:bg-[#ffffff08] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={save}
                        disabled={!ready}
                        className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                                   bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30
                                   disabled:bg-[#ffffff05] disabled:text-gray-600 disabled:border-[#ffffff10]"
                    >
                        Save chart
                    </button>
                </div>
            </div>
        </div>
    );
}
