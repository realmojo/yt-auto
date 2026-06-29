/**
 * Do Hyeon 로컬 폰트 — delayRender 없이 @font-face 주입(번들 staticFile).
 * delayRender 는 이 환경 렌더 컨텍스트에서 간헐적으로 안 풀려 렌더를 멈추게 하므로 쓰지 않는다.
 * 페이지는 프레임 간 유지되어 폰트는 시작 직후 1회 로드되면 이후 전 프레임에 적용된다.
 */
import { staticFile } from "remotion";

export const FONT = '"Do Hyeon", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

if (typeof document !== "undefined") {
  const url = staticFile("DoHyeon.ttf");
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"Do Hyeon";src:url(${url}) format("truetype");font-display:swap;}`;
  document.head.appendChild(style);
  try {
    const face = new FontFace("Do Hyeon", `url(${url}) format("truetype")`);
    face
      .load()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((l) => (document as any).fonts.add(l))
      .catch(() => {});
  } catch {
    /* noop */
  }
}
