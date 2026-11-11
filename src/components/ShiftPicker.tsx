import { SHIFT_CODES, type DayShift, type ShiftCode } from "../types.ts";
import { shiftClassName } from "../lib/shifts.ts";

type ShiftPickerProps = {
  month: number;
  day: number;
  shift: DayShift | undefined;
  onChange: (code: ShiftCode | null) => void;
};

export function ShiftPicker({ month, day, shift, onChange }: ShiftPickerProps) {
  return (
    <section className="picker" aria-label="修改班別">
      <div className="picker-meta">
        <strong>
          {month}月{day}日
        </strong>
        <span>原始：{shift?.raw.trim() || "無"}</span>
      </div>
      <div className="picker-options">
        {SHIFT_CODES.map((code) => (
          <button
            key={code}
            type="button"
            className={shift?.code === code ? `choice active ${shiftClassName(code)}` : `choice ${shiftClassName(code)}`}
            aria-pressed={shift?.code === code}
            onClick={() => onChange(code)}
          >
            {code}
          </button>
        ))}
        <button type="button" className="choice clear" onClick={() => onChange(null)}>
          清除這天
        </button>
      </div>
    </section>
  );
}
