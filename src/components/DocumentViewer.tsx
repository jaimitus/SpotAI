import React, { useState, useEffect } from 'react';
import { X, FileText, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DocumentViewerProps {
  file: File | null;
  content: string | null;
  onClose: () => void;
  highlightLine?: number | null;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ 
  file, 
  content, 
  onClose,
  highlightLine 
}) => {
  const { t } = useTranslation();
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (content) {
      setLines(content.split('\n'));
    }
  }, [content]);

  if (!file) return null;

  const isPdf = file.type === 'application/pdf';

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="font-medium text-sm truncate">{file.name}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed">
        {isPdf ? (
          <div className="text-zinc-500 italic text-center mt-10">
            {t('rag.pdfPreviewNotice')}
          </div>
        ) : (
          <div className="space-y-0.5">
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              const isHighlighted = highlightLine === lineNumber;
              
              return (
                <div
                  key={index}
                  id={`line-${lineNumber}`}
                  className={`
                    flex group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 px-2 py-0.5 rounded
                    ${isHighlighted ? 'bg-yellow-100 dark:bg-yellow-900/30 animate-pulse' : ''}
                  `}
                >
                  <span className="w-8 text-zinc-400 select-none text-xs pt-1 text-right pr-3 border-r border-zinc-200 dark:border-zinc-800 mr-3">
                    {lineNumber}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
                    {line || '\u00A0'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        
        {lines.length === 0 && !isPdf && (
          <div className="text-zinc-400 text-center mt-10">
            {t('rag.loadingContent')}
          </div>
        )}
      </div>
    </div>
  );
};
