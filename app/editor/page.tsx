import type { Metadata } from "next";

import { EditorShell } from "@/components/editor/editor-shell";

export const metadata: Metadata = {
  title: "영상 편집기 — YT Studio",
  description: "웹 기반 멀티트랙 영상 편집기: 자막·템플릿·미디어·내보내기",
};

export default function EditorPage() {
  return <EditorShell />;
}
