"use client";
import { useRouter } from "next/navigation";
import { ErrorPanel } from "./ui";

// Server pages render this when the database can't be reached
export function RetryError() {
  const router = useRouter();
  return <div className="wrap"><ErrorPanel onRetry={() => router.refresh()} /></div>;
}
