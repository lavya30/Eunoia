'use client';

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Code2,
  Ellipsis,
  Layers2,
  Minus,
} from 'lucide-react';
import type { ArrowRouting, BoardNode } from '@/lib/whiteboard/board-types';
import type { AlignType, DistributeAxis } from '@/lib/whiteboard/geometry';

export type LayerDirection = 'forward' | 'backward' | 'front' | 'back';

type StylePanelProps = {
  locked: boolean;
  /** Number of selected elements (nodes + arrows + strokes). */
  selectionCount: number;
  selectedNode: BoardNode | null;
  selectedId: string | null;
  selectedOpacity: number;
  selectedFontSize: number | null;
  selectedArrowRouting: ArrowRouting | null;
  arrowRouting: ArrowRouting;
  selectedArrowCount: number;
  selectedStrokeCount: number;
  selectedNodeCount?: number;
  brushSize: number;
  brushThinning: number;
  onClose: () => void;
  onApplyColor: (color: string, tone: BoardNode['tone']) => void;
  onUpdateNodes: (updates: Partial<BoardNode>) => void;
  onApplyArrowRouting: (routing: ArrowRouting) => void;
  onApplyBrushSize: (size: number) => void;
  onApplyBrushThinning: (thinning: number) => void;
  onApplyBulkOpacity: (opacity: number) => void;
  onApplyFontSize: (fontSize: number) => void;
  onMoveLayer: (direction: LayerDirection) => void;
  onAlignNodes?: (type: AlignType) => void;
  onDistributeNodes?: (axis: DistributeAxis) => void;
  hasGroupedSelection?: boolean;
  onGroupSelected?: () => void;
  onUngroupSelected?: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onCopyAsD2?: () => void;
};

/**
 * Selection style panel (extracted from WhiteboardPage). All controls are
 * bulk ops: they apply to every selected element of the relevant kind, and
 * the header reports the selection size.
 */
export function StylePanel({
  locked,
  selectionCount,
  selectedNode,
  selectedId,
  selectedOpacity,
  selectedFontSize,
  selectedArrowRouting,
  arrowRouting,
  selectedArrowCount,
  selectedStrokeCount,
  selectedNodeCount = 0,
  brushSize,
  brushThinning,
  onClose,
  onApplyColor,
  onUpdateNodes,
  onApplyArrowRouting,
  onApplyBrushSize,
  onApplyBrushThinning,
  onApplyBulkOpacity,
  onApplyFontSize,
  onMoveLayer,
  onAlignNodes,
  onDistributeNodes,
  hasGroupedSelection = false,
  onGroupSelected,
  onUngroupSelected,
  onDeleteSelected,
  onDuplicateSelected,
  onCopyAsD2,
}: StylePanelProps) {
  const hasSelection = selectionCount > 0;
  const subtitle = !hasSelection
    ? 'Nothing selected'
    : selectionCount === 1 && selectedNode && selectedId
      ? selectedNode.label
      : `${selectionCount} selected`;

  return (
    <aside className="board-style-panel" aria-label="Selected object style">
      <div className="style-panel-title">
        <div>
          <span>Style</span>
          <small>{subtitle}</small>
        </div>
        <button type="button" aria-label="Close style panel" onClick={onClose}>
          <Ellipsis size={16} />
        </button>
      </div>
      <fieldset
        disabled={locked}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
        <div className="style-section">
          <span className="style-label">Stroke</span>
          <div className="style-swatch-row">
            <button
              className="style-swatch style-swatch--ink is-selected"
              type="button"
              aria-label="Ink stroke"
              onClick={() => onApplyColor('#25263a', 'mint')}
            />
            <button
              className="style-swatch style-swatch--red"
              type="button"
              aria-label="Red stroke"
              onClick={() => onApplyColor('#df4c54', 'orange')}
            />
            <button
              className="style-swatch style-swatch--green"
              type="button"
              aria-label="Green stroke"
              onClick={() => onApplyColor('#3caa62', 'mint')}
            />
            <button
              className="style-swatch style-swatch--blue"
              type="button"
              aria-label="Blue stroke"
              onClick={() => onApplyColor('#4a86c6', 'blue')}
            />
            <button
              className="style-swatch style-swatch--orange"
              type="button"
              aria-label="Orange stroke"
              onClick={() => onApplyColor('#ef8c52', 'orange')}
            />
            <button
              className="style-swatch style-swatch--yellow"
              type="button"
              aria-label="Yellow stroke"
              onClick={() => onApplyColor('#f7d66f', 'yellow')}
            />
          </div>
        </div>
        <div className="style-section">
          <span className="style-label">Background</span>
          <div className="style-swatch-row">
            <button
              className="style-swatch style-swatch--transparent"
              type="button"
              aria-label="Transparent background"
              onClick={() => onUpdateNodes({ fill: 'none' })}
            />
            <button
              className="style-swatch style-swatch--lavender"
              type="button"
              aria-label="Lavender background"
              onClick={() => onUpdateNodes({ fill: '#dbd7fa' })}
            />
            <button
              className="style-swatch style-swatch--peach"
              type="button"
              aria-label="Peach background"
              onClick={() => onUpdateNodes({ fill: '#ffc8be' })}
            />
            <button
              className="style-swatch style-swatch--mint"
              type="button"
              aria-label="Mint background"
              onClick={() => onUpdateNodes({ fill: '#b9ebcf' })}
            />
            <button
              className="style-swatch style-swatch--sky"
              type="button"
              aria-label="Sky background"
              onClick={() => onUpdateNodes({ fill: '#badff3' })}
            />
            <button
              className="style-swatch style-swatch--lemon"
              type="button"
              aria-label="Lemon background"
              onClick={() => onUpdateNodes({ fill: '#ffe895' })}
            />
          </div>
        </div>
        <div className="style-section style-section--split">
          <div>
            <span className="style-label">Stroke width</span>
            <div className="style-choice-row">
              <button
                className="style-choice"
                type="button"
                aria-label="Thin stroke"
                onClick={() => onUpdateNodes({ strokeWidth: 1.5 })}
              >
                <Minus size={16} />
              </button>
              <button
                className="style-choice is-selected"
                type="button"
                aria-label="Medium stroke"
                onClick={() => onUpdateNodes({ strokeWidth: 2 })}
              >
                <Minus size={16} strokeWidth={2.6} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Thick stroke"
                onClick={() => onUpdateNodes({ strokeWidth: 4 })}
              >
                <Minus size={16} strokeWidth={4} />
              </button>
            </div>
          </div>
          <div>
            <span className="style-label">Stroke style</span>
            <div className="style-choice-row">
              <button
                className="style-choice is-selected"
                type="button"
                aria-label="Solid stroke"
                onClick={() => onUpdateNodes({ dashed: false })}
              >
                <Minus size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Dashed stroke"
                onClick={() => onUpdateNodes({ dashed: true })}
              >
                <Minus size={16} strokeDasharray="3 3" />
              </button>
            </div>
          </div>
        </div>
        <div className="style-section">
          <span className="style-label">Connector routing</span>
          <div className="style-choice-row">
            {(
              [
                { id: 'straight', label: 'Straight' },
                { id: 'orthogonal', label: 'Orthogonal' },
                { id: 'curved', label: 'Curved' },
              ] as Array<{ id: ArrowRouting; label: string }>
            ).map((option) => {
              const isActive =
                (selectedArrowRouting ?? arrowRouting) === option.id;
              return (
                <button
                  key={option.id}
                  className={`style-choice ${isActive ? 'is-selected' : ''}`}
                  type="button"
                  aria-label={`${option.label} routing`}
                  aria-pressed={isActive}
                  title={
                    selectedArrowCount > 0
                      ? `Apply ${option.label.toLowerCase()} routing to selection`
                      : `New arrows use ${option.label.toLowerCase()} routing`
                  }
                  onClick={() => onApplyArrowRouting(option.id)}
                >
                  <svg
                    width="22"
                    height="14"
                    viewBox="0 0 22 14"
                    aria-hidden="true"
                  >
                    {option.id === 'straight' && (
                      <line
                        x1="2"
                        y1="12"
                        x2="20"
                        y2="2"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    )}
                    {option.id === 'orthogonal' && (
                      <path
                        d="M 2 12 L 2 7 L 20 7 L 20 2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    )}
                    {option.id === 'curved' && (
                      <path
                        d="M 2 12 C 8 12, 14 2, 20 2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    )}
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
        <div className="style-section style-section--split">
          <div>
            <span className="style-label">Brush size</span>
            <div className="style-choice-row">
              {[
                { size: 4, label: 'Fine pen' },
                { size: 8, label: 'Medium pen' },
                { size: 16, label: 'Thick pen' },
              ].map((option) => (
                <button
                  key={option.size}
                  className={`style-choice ${brushSize === option.size ? 'is-selected' : ''}`}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={brushSize === option.size}
                  title={
                    selectedStrokeCount > 0
                      ? `Apply ${option.label.toLowerCase()} to selection`
                      : `New strokes use ${option.label.toLowerCase()}`
                  }
                  onClick={() => onApplyBrushSize(option.size)}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'block',
                      width: Math.min(18, 4 + option.size),
                      height: Math.min(18, 4 + option.size),
                      borderRadius: '50%',
                      background: 'currentColor',
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="style-label-row">
              <span className="style-label">Pressure</span>
              <span className="style-value">
                {Math.round(brushThinning * 100)}
              </span>
            </div>
            <input
              className="opacity-input"
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(brushThinning * 100)}
              aria-label="Pressure sensitivity"
              onChange={(event) =>
                onApplyBrushThinning(Number(event.target.value) / 100)
              }
            />
          </div>
        </div>
        <div className="style-section">
          <div className="style-label-row">
            <span className="style-label">Opacity (selection)</span>
            <span className="style-value">{selectedOpacity}</span>
          </div>
          <input
            className="opacity-input"
            type="range"
            min="10"
            max="100"
            step="5"
            value={selectedOpacity}
            aria-label="Selection opacity"
            disabled={!hasSelection || locked}
            title={
              hasSelection
                ? `Apply to ${selectionCount} selected`
                : 'Select objects to restyle'
            }
            onChange={(event) =>
              onApplyBulkOpacity(Number(event.target.value) / 100)
            }
          />
        </div>
        <div className="style-section">
          <div className="style-label-row">
            <span className="style-label">Font size (selection)</span>
            <span className="style-value">{selectedFontSize ?? '—'}</span>
          </div>
          <input
            className="opacity-input"
            type="range"
            min="8"
            max="96"
            step="1"
            value={selectedFontSize ?? 16}
            aria-label="Selection font size"
            disabled={selectedFontSize === null || locked}
            title="Apply to selected text & shapes"
            onChange={(event) => onApplyFontSize(Number(event.target.value))}
          />
        </div>
        <div className="style-section">
          <span className="style-label">Layers</span>
          <div className="style-choice-row style-choice-row--wide">
            <button
              className="style-choice"
              type="button"
              aria-label="Bring forward"
              title="Bring forward (])"
              onClick={() => onMoveLayer('forward')}
            >
              <Layers2 size={16} />
            </button>
            <button
              className="style-choice"
              type="button"
              aria-label="Send backward"
              title="Send backward ([)"
              onClick={() => onMoveLayer('backward')}
            >
              <Layers2 size={16} />
            </button>
            <button
              className="style-choice"
              type="button"
              aria-label="Bring to front"
              title="Bring to front (Shift+])"
              onClick={() => onMoveLayer('front')}
            >
              <Layers2 size={16} />
            </button>
            <button
              className="style-choice"
              type="button"
              aria-label="Send to back"
              title="Send to back (Shift+[)"
              onClick={() => onMoveLayer('back')}
            >
              <Layers2 size={16} />
            </button>
          </div>
        </div>
        {selectedNodeCount >= 2 && onAlignNodes && (
          <div className="style-section">
            <span className="style-label">Align</span>
            <div className="style-choice-row style-choice-row--wide">
              <button
                className="style-choice"
                type="button"
                aria-label="Align left"
                title="Align left"
                onClick={() => onAlignNodes('left')}
              >
                <AlignStartHorizontal size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Align center horizontal"
                title="Align center horizontal"
                onClick={() => onAlignNodes('center')}
              >
                <AlignCenterHorizontal size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Align right"
                title="Align right"
                onClick={() => onAlignNodes('right')}
              >
                <AlignEndHorizontal size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Align top"
                title="Align top"
                onClick={() => onAlignNodes('top')}
              >
                <AlignStartVertical size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Align middle vertical"
                title="Align middle vertical"
                onClick={() => onAlignNodes('middle')}
              >
                <AlignCenterVertical size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Align bottom"
                title="Align bottom"
                onClick={() => onAlignNodes('bottom')}
              >
                <AlignEndVertical size={16} />
              </button>
            </div>
          </div>
        )}
        {selectedNodeCount >= 3 && onDistributeNodes && (
          <div className="style-section">
            <span className="style-label">Distribute</span>
            <div className="style-choice-row style-choice-row--wide">
              <button
                className="style-choice"
                type="button"
                aria-label="Distribute horizontally"
                title="Distribute horizontally"
                onClick={() => onDistributeNodes('horizontal')}
              >
                <AlignHorizontalSpaceBetween size={16} />
              </button>
              <button
                className="style-choice"
                type="button"
                aria-label="Distribute vertically"
                title="Distribute vertically"
                onClick={() => onDistributeNodes('vertical')}
              >
                <AlignVerticalSpaceBetween size={16} />
              </button>
            </div>
          </div>
        )}
        <div className="style-section">
          <span className="style-label">Bulk actions</span>
          <div className="style-choice-row style-choice-row--wide">
            {onGroupSelected && selectionCount >= 2 && (
              <button
                className="style-choice"
                type="button"
                aria-label="Group selection"
                title="Group selection (Ctrl+G)"
                onClick={onGroupSelected}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px' }}
              >
                Group
              </button>
            )}
            {onUngroupSelected && hasGroupedSelection && (
              <button
                className="style-choice"
                type="button"
                aria-label="Ungroup selection"
                title="Ungroup selection (Ctrl+Shift+G)"
                onClick={onUngroupSelected}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px' }}
              >
                Ungroup
              </button>
            )}
            <button
              className="style-choice"
              type="button"
              aria-label="Duplicate selection"
              title="Duplicate selection (Ctrl+D)"
              disabled={!hasSelection}
              onClick={onDuplicateSelected}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px' }}
            >
              Dupl
            </button>
            <button
              className="style-choice"
              type="button"
              aria-label="Delete selection"
              title="Delete selection (Del)"
              disabled={!hasSelection}
              onClick={onDeleteSelected}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px' }}
            >
              Del
            </button>
            {onCopyAsD2 && (selectedNodeCount ?? 0) > 0 && (
              <button
                className="style-choice"
                type="button"
                aria-label="Copy selection as D2 code"
                title="Copy selected shapes as D2 code"
                onClick={onCopyAsD2}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  color: '#5b54c7',
                }}
              >
                <Code2 size={13} />
                D2
              </button>
            )}
          </div>
        </div>
      </fieldset>
      <div className="style-panel-footer">
        <span>
          {hasSelection ? `${selectionCount} selected` : 'Selected object'}
        </span>
        <span>⌘ K</span>
      </div>
    </aside>
  );
}
