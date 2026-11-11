import { useRef, useState, type ChangeEvent } from "react";
import { MonthCalendar } from "./components/MonthCalendar.tsx";
import { HangingPlaques, MonthScene } from "./components/MonthScene.tsx";
import { SettingsScreen } from "./components/SettingsScreen.tsx";
import { ShiftPicker } from "./components/ShiftPicker.tsx";
import { addMonths, daysInMonth } from "./lib/calendar.ts";
import { readPersonRow } from "./lib/ocr.ts";
import { clearSchedule, loadSchedule, loadSettings, saveSchedule, saveSettings, withDay } from "./lib/storage.ts";
import type { MonthSchedule, Settings, ShiftCode } from "./types.ts";

type View = "calendar" | "review" | "settings";

function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function initialSelection(year: number, month: number): number | null {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth() + 1 ? now.getDate() : null;
}

export default function App() {
  const initialSettings = loadSettings();
  const initialCursor = currentMonth();
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [cursor, setCursor] = useState(initialCursor);
  const [selectedDay, setSelectedDay] = useState<number | null>(initialSelection(initialCursor.year, initialCursor.month));
  const [schedule, setSchedule] = useState<MonthSchedule | null>(() =>
    loadSchedule(initialSettings.personName, initialCursor.year, initialCursor.month),
  );
  const [draft, setDraft] = useState<MonthSchedule | null>(null);
  const [view, setView] = useState<View>("calendar");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("正在讀取班表…");
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  const activeDraft = view === "review" ? draft : null;
  const saved =
    schedule &&
    schedule.year === cursor.year &&
    schedule.month === cursor.month &&
    schedule.personName === settings.personName
      ? schedule
      : null;
  const year = activeDraft?.year ?? cursor.year;
  const month = activeDraft?.month ?? cursor.month;
  const days = activeDraft?.days ?? saved?.days ?? {};

  function move(delta: number) {
    setMessage(null);
    if (activeDraft) {
      const next = addMonths(activeDraft.year, activeDraft.month, delta);
      setDraft({ ...activeDraft, ...next });
      setSelectedDay((day) => (day && day > daysInMonth(next.year, next.month) ? daysInMonth(next.year, next.month) : day));
      return;
    }
    const next = addMonths(cursor.year, cursor.month, delta);
    setSelectedDay(initialSelection(next.year, next.month));
    setCursor(next);
    setSchedule(loadSchedule(settings.personName, next.year, next.month));
  }

  function updateDraftDate(nextYear: number, nextMonth: number) {
    if (!draft) return;
    setDraft({ ...draft, year: nextYear, month: nextMonth });
    const maxDay = daysInMonth(nextYear, nextMonth);
    setSelectedDay((day) => (day && day > maxDay ? maxDay : day));
  }

  function updateDay(day: number, code: ShiftCode | null) {
    if (activeDraft) {
      setDraft(withDay(activeDraft, day, code));
      return;
    }
    const base: MonthSchedule = saved ?? {
      year: cursor.year,
      month: cursor.month,
      personName: settings.personName,
      days: {},
      updatedAt: new Date().toISOString(),
    };
    const next = withDay(base, day, code);
    if (Object.keys(next.days).length === 0) {
      clearSchedule(settings.personName, cursor.year, cursor.month);
      setSchedule(null);
      return;
    }
    saveSchedule(next);
    setSchedule(next);
  }

  function requestImport(input: HTMLInputElement | null) {
    input?.click();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setBusyLabel("正在讀取班表…");
    setMessage(null);
    try {
      const next = await readPersonRow(file, settings.personName, cursor.year, cursor.month, setBusyLabel);
      setDraft(next);
      setSelectedDay(initialSelection(next.year, next.month) ?? 1);
      setView("review");
      if (Object.keys(next.days).length === 0) setMessage("沒有讀到任何班別，請重新拍照或手動填寫。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "讀取班表失敗");
    } finally {
      setBusy(false);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void onFile(file);
  }

  function cancelReview() {
    if (draft && Object.keys(draft.days).length > 0 && !window.confirm("要放棄這次辨識結果嗎？")) return;
    setDraft(null);
    setView("calendar");
    setMessage(null);
    setSelectedDay(initialSelection(cursor.year, cursor.month));
  }

  function saveDraft() {
    if (!draft) return;
    const stored: MonthSchedule = {
      ...draft,
      personName: settings.personName,
      updatedAt: new Date().toISOString(),
    };
    if (Object.keys(stored.days).length === 0) {
      clearSchedule(stored.personName, stored.year, stored.month);
      setSchedule(null);
      setMessage("已清除這個月的班表");
    } else {
      saveSchedule(stored);
      setSchedule(stored);
      setMessage("已儲存班表");
    }
    setCursor({ year: stored.year, month: stored.month });
    setSelectedDay(initialSelection(stored.year, stored.month));
    setDraft(null);
    setView("calendar");
  }

  function clearViewedMonth() {
    const ok = window.confirm(`確定清除 ${cursor.year}年${cursor.month}月的班表？`);
    if (!ok) return;
    clearSchedule(settings.personName, cursor.year, cursor.month);
    setSchedule(null);
    setMessage("已清除這個月的班表");
  }

  function saveSettingsAndClose(next: Settings) {
    saveSettings(next);
    setSettings(next);
    setSchedule(loadSchedule(next.personName, cursor.year, cursor.month));
    setMessage(null);
    setView("calendar");
  }

  return (
    <div className="app" data-month={month} aria-busy={busy}>
      <MonthScene month={month} />
      {view === "settings" ? (
        <SettingsScreen
          settings={settings}
          year={cursor.year}
          month={cursor.month}
          hasSchedule={saved !== null && Object.keys(saved.days).length > 0}
          message={message}
          onSave={saveSettingsAndClose}
          onClear={clearViewedMonth}
        />
      ) : (
        <>
          <header className="top">
            <button type="button" className="arrow" aria-label="上個月" onClick={() => move(-1)}>
              <span className="triangle left" />
            </button>
            <div className="title-block">
              <h1>
                {year} 年 {month} 月
              </h1>
              <p>{settings.personName}</p>
            </div>
            <button type="button" className="arrow" aria-label="下個月" onClick={() => move(1)}>
              <span className="triangle right" />
            </button>
          </header>
          {activeDraft ? (
            <div className="review-bar">
              <p>請確認班表後再儲存</p>
              <div className="review-fields">
                <label>
                  年
                  <input
                    type="number"
                    inputMode="numeric"
                    min={2000}
                    max={2100}
                    value={activeDraft.year}
                    onChange={(event) => {
                      const nextYear = Number(event.target.value);
                      if (nextYear >= 2000 && nextYear <= 2100) updateDraftDate(nextYear, activeDraft.month);
                    }}
                  />
                </label>
                <label>
                  月
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    value={activeDraft.month}
                    onChange={(event) => {
                      const nextMonth = Number(event.target.value);
                      if (nextMonth >= 1 && nextMonth <= 12) updateDraftDate(activeDraft.year, nextMonth);
                    }}
                  />
                </label>
              </div>
            </div>
          ) : null}
          {message ? (
            <p className={message.startsWith("已") ? "banner ok" : "banner"} role="status">
              {message}
            </p>
          ) : null}
          {view === "calendar" && !saved && !message ? (
            <p className="hint">這個月還沒有班表。可拍整張班表，會找出{settings.personName}那一列。</p>
          ) : null}
          <HangingPlaques month={month} />
          <MonthCalendar year={year} month={month} days={days} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
          <div className="legend-row" aria-hidden="true">
            <span className="shift-class">課</span>
            <span className="shift-off">off</span>
            <span className="shift-night">0-8</span>
            <span className="shift-evening">16-0</span>
            <span className="shift-day">8-16</span>
          </div>
          {selectedDay !== null ? (
            <ShiftPicker month={month} day={selectedDay} shift={days[selectedDay]} onChange={(code) => updateDay(selectedDay, code)} />
          ) : null}
          <footer className="actions">
            {activeDraft ? (
              <>
                <button type="button" onClick={cancelReview}>
                  取消
                </button>
                <button type="button" className="primary" onClick={saveDraft}>
                  儲存
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => requestImport(cameraRef.current)}>
                  拍照
                </button>
                <button type="button" onClick={() => requestImport(albumRef.current)}>
                  相簿
                </button>
                <button type="button" onClick={() => setView("settings")}>
                  設定
                </button>
              </>
            )}
          </footer>
        </>
      )}
      {busy ? <div className="overlay">{busyLabel}</div> : null}
      <input ref={cameraRef} className="file-input" type="file" accept="image/*" capture="environment" onChange={handleFile} />
      <input ref={albumRef} className="file-input" type="file" accept="image/*" onChange={handleFile} />
    </div>
  );
}
