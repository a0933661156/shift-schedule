import { monthCells } from "../lib/calendar.ts";
import { shiftClassName, shiftText } from "../lib/shifts.ts";
import type { DayShift } from "../types.ts";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

type MonthCalendarProps = {
  year: number;
  month: number;
  days: Record<number, DayShift>;
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
};

export function MonthCalendar({ year, month, days, selectedDay, onSelectDay }: MonthCalendarProps) {
  const cells = monthCells(year, month);
  return (
    <div className="calendar">
      <div className="weekdays">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className={weekday === "日" ? "sunday" : undefined}>
            {weekday}
          </span>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(0, 1fr))` }}>
        {cells.map((day, index) =>
          day === null ? (
            <div key={`blank-${index}`} className="blank" />
          ) : (
            <button
              key={day}
              type="button"
              className={day === selectedDay ? "day selected" : "day"}
              aria-pressed={day === selectedDay}
              aria-label={`${month}月${day}日${shiftText(days[day]) ? ` ${shiftText(days[day])}` : ""}`}
              onClick={() => onSelectDay(day)}
            >
              <span className="date-num">{day}</span>
              {shiftText(days[day]) ? <span className={`shift ${shiftClassName(days[day]?.code)}`}>{shiftText(days[day])}</span> : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
