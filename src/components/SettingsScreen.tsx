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
  const [accessPassword, setAccessPassword] = useState(settings.accessPassword);

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
      <label>
        辨識密碼
        <input type="password" value={accessPassword} autoComplete="current-password" onChange={(event) => setAccessPassword(event.target.value)} />
      </label>
      <p className="field-hint">
        拍照時可以包含其他人。照片會先送到辨識服務，再由 GPT 看表格，只取出這個姓名那一列。辨識密碼存在這台裝置。額度用完時，會改在這台裝置上辨識，照片不會再上傳。
      </p>
      <button type="button" className="danger" disabled={!hasSchedule} onClick={onClear}>
        清除 {year}年{month}月班表
      </button>
      <button
        type="button"
        className="primary"
        onClick={() =>
          onSave({
            personName: personName.trim() || DEFAULT_SETTINGS.personName,
            accessPassword: accessPassword.trim(),
          })
        }
      >
        完成
      </button>
    </section>
  );
}
