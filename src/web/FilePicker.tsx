import type { ChangeEvent, ReactNode } from 'react';

type FilePickerProps = {
  id: string;
  label: string;
  pickerLabel: string;
  accept: string;
  filename?: string;
  placeholder: ReactNode;
  isLoading?: boolean;
  loadingLabel?: string;
  onChoose: (file: File) => void;
  allowDrop?: boolean;
};

export function chooseLocalFile(event: ChangeEvent<HTMLInputElement>, onChoose: (file: File) => void) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = '';
  if (file) onChoose(file);
}

export default function FilePicker({ id, label, pickerLabel, accept, filename, placeholder, isLoading, loadingLabel, onChoose, allowDrop }: FilePickerProps) {
  return (
    <div className="file-picker">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="file-box" onDragOver={allowDrop ? (event) => event.preventDefault() : undefined} onDrop={allowDrop ? (event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onChoose(file);
      } : undefined}>
        <span className="file-icon" aria-hidden="true" />
        {filename && !isLoading
          ? <bdi dir="auto" className="loaded-filename">{filename}</bdi>
          : <span className="quiet">{isLoading ? loadingLabel : placeholder}</span>}
        <label className="file-action">
          <span>{pickerLabel}</span>
          <input
            type="file"
            id={id}
            data-testid={id}
            accept={accept}
            aria-label={pickerLabel}
            onChange={(event) => chooseLocalFile(event, onChoose)}
          />
        </label>
      </div>
    </div>
  );
}
