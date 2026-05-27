import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "특수도료 AI 검토 시스템",
  description:
    "Gemini, Claude, GPT가 라운드 기반 회의를 거쳐 업체 발송용 기술 답변을 작성하는 Hanmir Coatings 검토 도구입니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
