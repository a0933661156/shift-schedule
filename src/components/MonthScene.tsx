import frame01 from "../assets/frames/frame-01.jpg";
import frame02 from "../assets/frames/frame-02.jpg";
import frame03 from "../assets/frames/frame-03.jpg";
import frame04 from "../assets/frames/frame-04.jpg";
import frame05 from "../assets/frames/frame-05.jpg";
import frame06 from "../assets/frames/frame-06.jpg";
import frame07 from "../assets/frames/frame-07.jpg";
import frame08 from "../assets/frames/frame-08.jpg";
import frame09 from "../assets/frames/frame-09.jpg";
import frame10 from "../assets/frames/frame-10.jpg";
import frame11 from "../assets/frames/frame-11.jpg";
import frame12 from "../assets/frames/frame-12.jpg";

const frames = [frame01, frame02, frame03, frame04, frame05, frame06, frame07, frame08, frame09, frame10, frame11, frame12];

const plaques: Record<number, { left: string; right: string }> = {
  1: { left: "元旦", right: "新年" },
  2: { left: "新春", right: "元宵" },
  3: { left: "春分", right: "花朝" },
  4: { left: "清明", right: "穀雨" },
  5: { left: "立夏", right: "小滿" },
  6: { left: "端午", right: "芒種" },
  7: { left: "小暑", right: "大暑" },
  8: { left: "七夕", right: "處暑" },
  9: { left: "中秋", right: "白露" },
  10: { left: "萬聖", right: "霜降" },
  11: { left: "立冬", right: "小雪" },
  12: { left: "聖誕", right: "冬至" },
};

export function MonthScene({ month }: { month: number }) {
  const src = frames[month - 1] ?? frame01;
  return <img className="month-scene" src={src} alt="" />;
}

export function HangingPlaques({ month }: { month: number }) {
  const plaque = plaques[month] ?? plaques[1];
  return (
    <>
      <div className="plaque left" aria-hidden="true">
        <span>{plaque.left}</span>
      </div>
      <div className="plaque right" aria-hidden="true">
        <span>{plaque.right}</span>
      </div>
    </>
  );
}
