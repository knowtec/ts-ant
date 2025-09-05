import './global.css';
import { robotoSlab, archivo } from "../fonts";

export const metadata = {
  title: "Termo Shop x L'ETAPE SLovenia",
  description: "ANT+ leaderboard (Node+SQLite)",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sl" className={`${robotoSlab.variable} ${archivo.variable}`}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
