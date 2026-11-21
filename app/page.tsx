import { redirect } from "next/navigation";

// The front door is the growth programme. Guests reach the booking widget at /book.
export default function Home() {
  redirect("/growth");
}
