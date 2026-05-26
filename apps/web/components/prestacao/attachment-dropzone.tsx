"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

const DEFAULT_ACCEPT = ".pdf,.xlsx,.xls,.ofx";
const ALLOWED_SUFFIXES = new Set([".pdf", ".xlsx", ".xls", ".ofx"]);

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function suffixOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function kindLabel(suffix: string): string {
  if (suffix === ".pdf") return "PDF";
  if (suffix === ".ofx") return "OFX";
  if (suffix === ".xlsx" || suffix === ".xls") return "Planilha Excel";
  return "Arquivo";
}

function filterAllowed(files: File[]): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const suffix = suffixOf(file.name);
    if (ALLOWED_SUFFIXES.has(suffix)) {
      accepted.push(file);
    } else {
      rejected.push(file.name);
    }
  }
  return { accepted, rejected };
}

function mergeFiles(existing: File[], incoming: File[]): File[] {
  const map = new Map<string, File>();
  for (const f of [...existing, ...incoming]) {
    map.set(fileKey(f), f);
  }
  return Array.from(map.values());
}

function FileTypeIcon({ suffix }: { suffix: string }) {
  if (suffix === ".pdf") {
    return (
      <svg aria-hidden className="h-8 w-8 shrink-0 text-up-black/80" viewBox="0 0 24 24" fill="none">
        <path
          d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 12h8M8 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (suffix === ".ofx") {
    return (
      <svg aria-hidden className="h-8 w-8 shrink-0 text-up-black/80" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 9h8M8 12h8M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden className="h-8 w-8 shrink-0 text-up-black/80" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 9h8M8 12h8M8 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 9v6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AttachmentPreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const suffix = suffixOf(file.name);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);

  useEffect(() => {
    if (suffix === ".pdf") {
      const url = URL.createObjectURL(file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    return undefined;
  }, [file, suffix]);

  useEffect(() => {
    if (suffix !== ".ofx") {
      setTextPreview(null);
      return undefined;
    }
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (cancelled) return;
      const raw = typeof reader.result === "string" ? reader.result : "";
      const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, 480);
      setTextPreview(trimmed || "(arquivo vazio ou binário)");
    };
    reader.onerror = () => {
      if (!cancelled) setTextPreview("(não foi possível ler o conteúdo)");
    };
    reader.readAsText(file.slice(0, 64_000));
    return () => {
      cancelled = true;
    };
  }, [file, suffix]);

  return (
    <li className="overflow-hidden rounded-md border border-border bg-surface-card">
      <div className="flex items-start gap-3 border-b border-border px-3 py-2.5">
        <FileTypeIcon suffix={suffix} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-up-black" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted">
            {kindLabel(suffix)} · {formatBytes(file.size)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 ease-out-quart hover:bg-slate-100 hover:text-up-black focus:outline-none focus:ring-1 focus:ring-up-black"
          aria-label={`Remover ${file.name}`}
        >
          Remover
        </button>
      </div>

      {suffix === ".pdf" && objectUrl ? (
        <div className="border-t border-border bg-slate-50/80">
          <iframe
            title={`Pré-visualização de ${file.name}`}
            src={objectUrl}
            className="h-44 w-full border-0 bg-white"
          />
        </div>
      ) : null}

      {suffix === ".ofx" && textPreview ? (
        <pre className="max-h-36 overflow-auto border-t border-border bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-up-black/90">
          {textPreview}
          {textPreview.length >= 480 ? "…" : ""}
        </pre>
      ) : null}

      {(suffix === ".xlsx" || suffix === ".xls") && (
        <p className="border-t border-border bg-slate-50/80 px-3 py-2.5 text-xs text-muted">
          Pré-visualização de planilha disponível após o processamento. O arquivo será ingerido na
          prestação.
        </p>
      )}
    </li>
  );
}

export type AttachmentDropzoneProps = {
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  label?: string;
  hint?: string;
};

export function AttachmentDropzone({
  files,
  onChange,
  accept = DEFAULT_ACCEPT,
  label = "Anexos (PDF, Excel, OFX)",
  hint = "Arraste arquivos aqui ou clique para escolher. Formatos: PDF, XLS, XLSX, OFX.",
}: AttachmentDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);

  const addFiles = useCallback(
    (incoming: File[]) => {
      const { accepted, rejected } = filterAllowed(incoming);
      if (rejected.length > 0) {
        setRejectMsg(
          rejected.length === 1
            ? `Formato não suportado: ${rejected[0]}`
            : `Formatos não suportados: ${rejected.join(", ")}`,
        );
      } else {
        setRejectMsg(null);
      }
      if (accepted.length > 0) {
        onChange(mergeFiles(files, accepted));
      }
    },
    [files, onChange],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list?.length) addFiles(Array.from(list));
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="space-y-3">
      <span id={`${inputId}-label`} className="block text-sm font-medium text-up-black">
        {label}
      </span>

      <div
        role="button"
        tabIndex={0}
        aria-labelledby={`${inputId}-label`}
        aria-describedby={`${inputId}-hint`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onClick={openPicker}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragActive(false);
        }}
        onDrop={onDrop}
        className={`relative cursor-pointer rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors duration-150 ease-out-quart focus:outline-none focus:ring-2 focus:ring-up-black focus:ring-offset-2 ${
          dragActive
            ? "border-up-yellow bg-amber-50/60"
            : "border-border bg-slate-50/50 hover:border-up-black/30 hover:bg-slate-50"
        }`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          onChange={onInputChange}
          tabIndex={-1}
        />
        <p className="text-sm font-medium text-up-black">
          {dragActive ? "Solte os arquivos aqui" : "Arraste e solte ou clique para escolher"}
        </p>
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      </div>

      {rejectMsg ? (
        <p className="text-sm text-status-danger-text" role="alert">
          {rejectMsg}
        </p>
      ) : null}

      {files.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            {files.length === 1 ? "1 arquivo selecionado" : `${files.length} arquivos selecionados`}
          </p>
          <ul className="space-y-3">
            {files.map((file) => (
              <AttachmentPreview
                key={fileKey(file)}
                file={file}
                onRemove={() => onChange(files.filter((f) => fileKey(f) !== fileKey(file)))}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
