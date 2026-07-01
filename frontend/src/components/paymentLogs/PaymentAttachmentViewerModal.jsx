import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const isImageUrl = (url) =>
  typeof url === 'string' && /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(url);

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.01;

/**
 * Full-screen overlay modal for payment receipt / attachment preview.
 * Zoom applies to the image only inside a fixed-size scroll area; modal chrome stays the same.
 */
const PaymentAttachmentViewerModal = ({ open, url, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const viewerRef = useRef(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  useEffect(() => {
    if (open) setZoom(1);
  }, [open, url]);

  const showImage = isImageUrl(url || '');

  const resetZoom = () => setZoom(1);

  const handleImageMouseDown = (e) => {
    if (!showImage || zoom <= 1 || !viewerRef.current) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewerRef.current.scrollLeft,
      scrollTop: viewerRef.current.scrollTop,
    };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragRef.current.active || !viewerRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      viewerRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
      viewerRef.current.scrollTop = dragRef.current.scrollTop - dy;
    };

    const stopDragging = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      setIsDragging(false);
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDragging);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDragging);
      document.body.style.userSelect = '';
    };
  }, []);

  if (!open || !url) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Payment attachment"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-gray-200 shrink-0">
          <span className="text-sm font-medium text-gray-700">Payment attachment</span>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {showImage && (
              <button
                type="button"
                onClick={resetZoom}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-4 flex flex-col">
          {showImage && (
            <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-600 mb-1">Zoom: {Math.round(zoom * 100)}%</div>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full h-2 accent-primary-600 cursor-pointer"
                aria-label="Attachment zoom"
              />
              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                <span>{Math.round(ZOOM_MIN * 100)}%</span>
                <span>{Math.round(ZOOM_MAX * 100)}%</span>
              </div>
            </div>
          )}
          <div
            ref={viewerRef}
            onMouseDown={handleImageMouseDown}
            className="flex-1 min-h-0 w-full overflow-auto rounded-lg border border-gray-200 bg-gray-100"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
              maxHeight: '75vh',
              cursor: showImage && zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
            }}
          >
            {showImage ? (
              <img
                src={url}
                alt="Payment attachment"
                className="block h-auto select-none mx-auto"
                style={{
                  width: `${100 * zoom}%`,
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                }}
                draggable={false}
              />
            ) : (
              <iframe
                src={url}
                title="Payment attachment"
                className="w-full min-h-[70vh] border-0 bg-gray-50"
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PaymentAttachmentViewerModal;
