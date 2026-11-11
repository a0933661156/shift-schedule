import { useState } from "react";
import { DEFAULT_SETTINGS } from "../lib/storage.ts";
import type { Settings } from "../types.ts";

type SettingsScreenProps = {
  settings: Settings;
  year: number;
  month: number;
  hasSchedule: boolean;
  message: string | null;
  onSave: (settings: Settings) => void;
  onClear: () => void;
};

export function SettingsScreen({ settings, year, month, hasSchedule, message, onSave, onClear }: SettingsScreenProps) {
  const [personName, setPersonName] = useState(settings.personName);

  return (
    <section className="settings">
      <h1>設定</h1>
      {message ? (
        <p className="banner" role="status">
          {message}
        </p>
      ) : null}
      <label>
        姓名
        <input value={personName} onChange={(event) => setPersonName(event.target.value)} />
      </label>
      <p className="field-hint">
        拍照時可以包含其他人。照片會上傳到 Gemini 看表格，只取出這個姓名那一列。免費次數用完時，會改在這台裝置上辨識，照片不會再上傳。
      </p>
      <button type="button" className="danger" disabled={!hasSchedule} onClick={onClear}>
        清除 {year}年{month}月班表
      </button>
      <button
        type="button"
        className="primary"
        onClick={() => onSave({ personName: personName.trim() || DEFAULT_SETTINGS.personName })}
      >
        完成
      </button>
    </section>
  );
}
