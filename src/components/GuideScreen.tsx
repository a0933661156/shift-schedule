type GuideScreenProps = {
  onBack: () => void;
};

export function GuideScreen({ onBack }: GuideScreenProps) {
  return (
    <section className="settings guide">
      <h1>使用說明</h1>
      <p>這是自己的班表月曆。拍下整張紙本班表後，網頁只取出設定裡那個姓名的一列。</p>
      <p>班表存在這台手機，不會跟另一台同步。另一個人要在自己的手機打開，到設定把姓名改成自己的名字。</p>

      <h2>看班表與修改</h2>
      <p>左右箭頭可以換月。點某一天，可改成課、off、0-8、16-0、8-16，或清除這天。</p>

      <h2>從照片讀班表</h2>
      <p>用拍照或相簿選整張清楚的班表。照片裡可以有其他人。畫面會先顯示辨識結果，確認年月與每天班別後再按儲存。按取消就不會存。</p>
      <p>同一天 08-12 加 13-17 是課。00-08 是 0-8。16-00 是 16-0。08-16 是 8-16。例假、休假、休息日、特別休假是 off。</p>

      <h2>設定</h2>
      <p>辨識密碼已填好，通常不用改。設定裡也可以清除這一個月的班表。</p>

      <h2>iPhone 加到主畫面</h2>
      <p>請用 Safari 加入。若連結是在 LINE 裡打開，先選用 Safari 開啟，再做下面的步驟。</p>
      <ol>
        <li>
          用 Safari 打開 <a href="https://a0933661156.github.io/shift-schedule/">https://a0933661156.github.io/shift-schedule/</a>
        </li>
        <li>點下方中間的分享按鈕。</li>
        <li>往下滑，點「加入主畫面」。</li>
        <li>名稱維持「護理班表」，再點「加入」。</li>
        <li>之後從桌面圖示打開。</li>
      </ol>
      <button type="button" onClick={onBack}>
        返回
      </button>
    </section>
  );
}
