import './global.css';
import { robotoSlab } from "../fonts";

export const metadata = {
  title: "TermoShop Charity Ride",
  description: "ANT+ leaderboard (Node+SQLite)",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sl" className={robotoSlab.variable}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
