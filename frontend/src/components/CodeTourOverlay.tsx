"use client";

interface CodeTourOverlayProps {
  title: string;
  currentIndex: number;
  totalStops: number;
  explanation: string;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export function CodeTourOverlay({
  title,
  currentIndex,
  totalStops,
  explanation,
  onPrev,
  onNext,
  onClose,
  hasPrev,
  hasNext,
}: CodeTourOverlayProps) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-md"
      style={{ zIndex: 1000 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-blue-600">
          {currentIndex + 1}/{totalStops} - {title}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-sm leading-none ml-2"
          aria-label="Close tour"
        >
          x
        </button>
      </div>
      <p className="text-sm text-gray-700 mb-2 leading-relaxed">
        {explanation}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="text-xs border rounded px-2 py-0.5 hover:bg-gray-100 disabled:opacity-30"
        >
          Prev
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="text-xs border rounded px-2 py-0.5 hover:bg-gray-100 disabled:opacity-30"
        >
          Next
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          Enter/Shift+Enter to navigate, Esc to exit
        </span>
      </div>
    </div>
  );
}
