# 護理班表

別人可以直接打開：[https://a0933661156.github.io/shift-schedule/](https://a0933661156.github.io/shift-schedule/)

用手機或電腦看自己的班表。拍下整張紙本班表後，網頁找出你的那一列，整理成月曆。班別會對應成課、off、0-8、16-0、8-16。確認後存在這台裝置的瀏覽器裡，不會上傳班表內容。

照片本身會送到 [OCR.space](https://ocr.space/ocrapi) 做免費文字辨識。同一個網路一天大約可以辨識 10 次。照片可以包含其他同事，程式只採用設定頁裡的姓名那一列。

## 在自己的電腦執行

```bash
npm install
npm run dev
```

瀏覽器打開終端機顯示的本機網址。手機和電腦在同一個 Wi-Fi 時，可以用終端機印出的 Network 網址。

## 發佈到 GitHub Pages

推上 `main` 後，GitHub Actions 會建置並發佈到上面的網址。別人打開網頁就能使用，不必另外申請金鑰。照片會送到免費辨識；免費次數用完時，改在那台裝置上辨識。
