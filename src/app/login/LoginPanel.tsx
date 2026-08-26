"use client";

import { useState } from "react";
import PinPad from "./PinPad";
import LoginForm from "./LoginForm";

export default function LoginPanel() {
  const [mode, setMode] = useState<"pin" | "email">("pin");

  if (mode === "pin") return <PinPad onUseEmail={() => setMode("email")} />;

  return (
    <div className="space-y-3">
      <LoginForm />
      <button
        type="button"
        onClick={() => setMode("pin")}
        className="w-full text-center text-xs font-semibold text-ink-400 underline"
      >
        กลับไปใช้ PIN
      </button>
    </div>
  );
}
