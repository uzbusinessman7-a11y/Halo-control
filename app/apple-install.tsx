"use client";

import { useEffect, useRef, useState } from "react";

type AppleNavigator = Navigator & { standalone?: boolean };
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type InstallPlatform = "apple" | "windows" | "other";

export default function AppleInstall() {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("other");
  const promptRef = useRef<InstallPrompt | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const appleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const windowsDevice = /Windows/i.test(navigator.userAgent);
    const isStandalone = () => displayMode.matches || Boolean((navigator as AppleNavigator).standalone);
    const updateMode = () => {
      setInstalled(isStandalone());
    };
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPrompt;
    };
    const confirmInstall = () => {
      setInstalled(true);
      setOpen(false);
    };
    updateMode();
    const initialUiTimer = window.setTimeout(() => {
      setPlatform(appleDevice ? "apple" : windowsDevice ? "windows" : "other");
      if (!isStandalone() && window.location.hash === "#windows-app") setOpen(true);
    }, 0);
    displayMode.addEventListener?.("change", updateMode);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", confirmInstall);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => {
      window.clearTimeout(initialUiTimer);
      displayMode.removeEventListener?.("change", updateMode);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", confirmInstall);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const install = async () => {
    const prompt = promptRef.current;
    if (!prompt) {
      setOpen(true);
      return;
    }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      promptRef.current = null;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        return;
      }
    } catch {
      promptRef.current = null;
    }
    setOpen(true);
  };

  const isWindows = platform === "windows";
  const isApple = platform === "apple";

  if (installed && !open) {
    return <span className="app-installed-badge"><i /> {isWindows ? "Windows ilova" : "Ilova o‘rnatilgan"}</span>;
  }

  return (
    <>
      <button
        className={`install-app-button${isWindows ? " windows" : ""}`}
        type="button"
        onClick={() => void install()}
        aria-label={isWindows ? "HALO Control Windows ilovasini o‘rnatish" : "HALO Control ilovasini o‘rnatish"}
      >
        <span>{isWindows ? "⊞" : isApple ? "" : "↓"}</span>
        <b>{isWindows ? "Windows’ga o‘rnatish" : isApple ? "iPhone’ga o‘rnatish" : "Ilovani o‘rnatish"}</b>
      </button>

      {open && (
        <div className="install-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="install-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={`install-modal-icon${isWindows ? " windows" : ""}`} aria-hidden="true">H{isWindows && <i>⊞</i>}</div>
            <span className="install-kicker">{isWindows ? "WINDOWS ILOVA" : isApple ? "APPLE ILOVA" : "HALO ILOVA"}</span>
            <h2 id="install-title">HALO Control’ni {isWindows ? "Windows’ga" : "qurilmangizga"} o‘rnating</h2>
            <p>{isWindows
              ? "Bir marta o‘rnatsangiz, HALO Control Start menyusi va ish stolida alohida dastur kabi ochiladi."
              : "Bir marta o‘rnatsangiz, HALO belgisi orqali to‘liq ekran rejimida kirasiz."}</p>

            {isWindows ? <ol className="install-steps">
              <li><b>1</b><span>Ushbu sahifani <strong>Microsoft Edge</strong> yoki <strong>Google Chrome</strong> brauzerida oching.</span></li>
              <li><b>2</b><span>Manzil qatoridagi <strong>ilova o‘rnatish</strong> belgisini bosing. Edge’da: <strong>⋯ → Apps → Install HALO Control</strong>.</span></li>
              <li><b>3</b><span>Chiqqan oynadan <strong>Install / 설치</strong> tugmasini bosing.</span></li>
              <li><b>4</b><span><strong>Start menyusi</strong>, <strong>vazifalar paneli</strong> yoki <strong>ish stoli</strong> yorlig‘ini tanlang.</span></li>
            </ol> : isApple ? <ol className="install-steps">
              <li><b>1</b><span>Saytni <strong>Safari</strong> brauzerida oching.</span></li>
              <li><b>2</b><span>Pastdagi <strong>Ulashish</strong> <i>□↑</i> belgisini bosing.</span></li>
              <li><b>3</b><span><strong>“Add to Home Screen”</strong> yoki <strong>“홈 화면에 추가”</strong> ni tanlang.</span></li>
              <li><b>4</b><span>Yuqoridagi <strong>“Add / 추가”</strong> tugmasini bosing.</span></li>
            </ol> : <ol className="install-steps">
              <li><b>1</b><span>Sahifani <strong>Chrome</strong> brauzerida oching.</span></li>
              <li><b>2</b><span>Brauzer menyusidan <strong>Install app</strong> yoki <strong>Add to Home Screen</strong> ni tanlang.</span></li>
              <li><b>3</b><span><strong>Install / Add</strong> tugmasini bosing.</span></li>
              <li><b>4</b><span>HALO belgisi qurilmangizning ilovalar ro‘yxatida paydo bo‘ladi.</span></li>
            </ol>}

            <div className="install-modal-note">
              <i>✓</i>
              <span>Ma’lumotlaringiz o‘zgarmaydi. Windows, telefon va sayt bir xil HALO Control bazasidan foydalanadi; yangilanishlar avtomatik keladi. Ishlash uchun internet aloqasi kerak.</span>
            </div>

            <button ref={closeButton} className="install-close" type="button" onClick={() => setOpen(false)}>
              Tushundim
            </button>
          </section>
        </div>
      )}
    </>
  );
}
