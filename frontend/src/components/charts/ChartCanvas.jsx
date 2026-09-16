import React from 'react';
import { COLUMNS, columnKey, columnLabel } from '../../columns';
import ScatterPlot from './ScatterPlot';
import BarChartPanel from './BarChartPanel';
import PriceTrackerPanel from './PriceTrackerPanel';

const colById = (id) => COLUMNS.find(c => c.id === id);

/**
 * Renders whichever chart a config describes.
 *
 * Shared by the saved-chart list and the builder's live preview, so what you see
 * before saving is produced by exactly the same code that draws it afterwards.
 */
export default function ChartCanvas({ chart, rows, available, scoreMetric, showLayers, onChange, sizeOptions, season, games, onSelectPlayer }) {
    // Charts with an explicit kind bring their own data and axes, so they are resolved
    // before anything tries to read x/y off the aggregated player table.
    if (chart.kind === 'priceHistory') {
        return <PriceTrackerPanel season={season} games={games} onSelectPlayer={onSelectPlayer} />;
    }

    const x = colById(chart.x);
    const y = colById(chart.y);
    if (!x || !y) return null;

    const labelFor = (col) => columnLabel(col, true, scoreMetric);
    const xKey = columnKey(x, true);
    const yKey = columnKey(y, true);
    const xLabel = labelFor(x);
    const yLabel = labelFor(y);

    const missing = available && (!available.has(x.id) || !available.has(y.id));
    if (missing) {
        return (
            <div className="h-[200px] flex items-center justify-center text-center text-sm text-gray-500 px-6">
                No data for {!available.has(x.id) ? xLabel : yLabel} with the current
                season and games selection, so this chart can’t be drawn.
            </div>
        );
    }

    if (x.axis === 'category' || y.axis === 'category') {
        const categoryFirst = x.axis === 'category';
        return (
            <BarChartPanel
                data={rows}
                categoryKey={categoryFirst ? xKey : yKey}
                valueKey={categoryFirst ? yKey : xKey}
                categoryLabel={categoryFirst ? xLabel : yLabel}
                valueLabel={categoryFirst ? yLabel : xLabel}
            />
        );
    }

    return (
        <>
            {showLayers && <LayerBar chart={chart} onChange={onChange} sizeOptions={sizeOptions} />}
            <ScatterPlot
                data={rows}
                xKey={xKey}
                yKey={yKey}
                xLabel={xLabel}
                yLabel={yLabel}
                colorBy={chart.layers.colorBy ? 'position' : null}
                showQuadrants={chart.layers.quadrants}
                labelTop={chart.layers.labels ? 8 : 0}
                sizeBy={chart.layers.sizeBy ? columnKey(colById(chart.layers.sizeBy), true) : null}
                // Absent in the builder's preview, deliberately: clicking a preview
                // point must not stack a player modal on top of the builder modal.
                onSelectPlayer={onSelectPlayer}
                tooltipFields={[
                    { key: yKey, label: yLabel },
                    { key: xKey, label: xLabel },
                    { key: 'CR', label: 'CR' },
                ]}
            />
        </>
    );
}

const LAYER_TOGGLES = [
    { key: 'colorBy', label: 'Colour by position' },
    { key: 'quadrants', label: 'Median quadrants' },
    { key: 'labels', label: 'Label top players' },
];

export function LayerBar({ chart, onChange, sizeOptions = [] }) {
    return (
        <div className="flex flex-wrap items-center gap-2 mb-3">
            {LAYER_TOGGLES.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onChange({ ...chart, layers: { ...chart.layers, [key]: !chart.layers[key] } })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${chart.layers[key]
                        ? 'bg-purple-600/20 text-purple-300 border-purple-500/40'
                        : 'bg-[#ffffff05] text-gray-500 border-[#ffffff10] hover:text-gray-300'}`}
                >
                    {label}
                </button>
            ))}
            <select
                value={chart.layers.sizeBy ?? ''}
                onChange={(e) => onChange({
                    ...chart,
                    layers: { ...chart.layers, sizeBy: e.target.value || null },
                })}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border bg-[#0a0a0c] transition-colors ${chart.layers.sizeBy
                    ? 'text-purple-300 border-purple-500/40'
                    : 'text-gray-500 border-[#ffffff10]'}`}
            >
                <option value="">Size: uniform</option>
                {sizeOptions.map(col => (
                    <option key={col.id} value={col.id}>
                        Size: {col.pickerLabel ?? (typeof col.label === 'function' ? 'Score' : col.label)}
                    </option>
                ))}
            </select>
        </div>
    );
}
