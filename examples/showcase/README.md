# 예제 덱 · Example deck

README 영상 촬영에 쓰는 예제 덱입니다. 실제 발표 덱의 엔진(`app.js`)과 디자인(`styles.css`)을 그대로 가져왔고, 내용은 가상의 사내 워크숍입니다.
The example deck used for the README videos: a real presentation deck's engine (`app.js`) and design (`styles.css`) with made-up workshop content.

| 파일 · File | |
|---|---|
| `index.html` + `slides.js` | 한국어 · Korean |
| `en.html` + `slides.en.js` | English |
| `fonts/` | Geist · Geist Mono · Pretendard (SIL Open Font License, see `LICENSE-*.txt`) |

```bash
redpen examples/showcase/index.html          # 한국어
redpen examples/showcase/en.html --lang en   # English
```

내용은 `slides.js` / `slides.en.js`만 고치면 됩니다 (←/→ 이동, G 목차, F 전체 화면). Edit only the slides files (←/→ to move, G for all slides, F for full screen).
