(() => {
  const S = [];
  const slide = (title, eyebrow, body) => S.push({ title, eyebrow, body });

  S.push({
    raw: `<section class="slide cover" data-title="표지">
      <div class="kicker">DATA 101 · 사내 교육</div>
      <h1>데이터 분석 입문</h1>
      <p class="sub">엑셀에서 파이썬까지, 첫 분석 프로젝트를 끝까지 해 봅니다</p>
      <div class="meta"><strong>홍길동</strong> · 데이터팀</div>
    </section>`,
  });

  slide("분석의 4단계", "PROCESS", `
    <ol class="steps">
      <li><b>질문</b> — 무엇을 알고 싶은지 한 문장으로 정한다</li>
      <li><b>수집</b> — 필요한 데이터를 모으고 출처를 기록한다</li>
      <li><b>정제</b> — 결측치와 이상치를 처리한다</li>
      <li><b>해석</b> — 숫자를 의사결정의 언어로 바꾼다</li>
    </ol>
  `);

  slide("결측치 처리", "CLEANING", `
    <div class="two">
      <div class="box"><h3>삭제</h3><p>결측이 적고 무작위일 때 행을 지웁니다. 가장 간단하지만 데이터가 줄어듭니다.</p></div>
      <div class="box"><h3>대체</h3><p>평균·중앙값·최빈값으로 채웁니다. 분포가 왜곡될 수 있으니 주의하세요.</p></div>
    </div>
    <p class="note">팁: 결측치는 지우기 전에 <strong>왜 비어 있는지</strong>부터 확인하세요.</p>
  `);

  slide("요약", "SUMMARY", `
    <ul class="points">
      <li>좋은 질문이 좋은 분석을 만든다</li>
      <li>정제에 전체 시간의 70%가 든다</li>
      <li>결과는 그래프 하나로 말하게 하라</li>
    </ul>
  `);

  window.SLIDES = S;
})();
