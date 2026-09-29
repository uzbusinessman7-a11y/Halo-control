"use client";

import { useEffect, useRef, useState } from "react";
import { translateWorker, type WorkerLanguage } from "./lib/worker-i18n";

type AppleNavigator = Navigator & { standalone?: boolean };
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function XodimInstall({ compact = false, language = "uz" }: { compact?: boolean; language?: WorkerLanguage }) {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [appleDevice, setAppleDevice] = useState(false);
  const promptRef = useRef<InstallPrompt | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const t = (key: Parameters<typeof translateWorker>[1]) => translateWorker(language, key);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const updateMode = () => {
      setInstalled(displayMode.matches || Boolean((navigator as AppleNavigator).standalone));
    };
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPrompt;
    };
    updateMode();
    const initialUiTimer = window.setTimeout(() => {
      setAppleDevice(isAppleDevice);
      if (window.location.hash === "#iphone-app") setOpen(true);
    }, 0);
    displayMode.addEventListener?.("change", updateMode);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    return () => {
      window.clearTimeout(initialUiTimer);
      displayMode.removeEventListener?.("change", updateMode);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
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
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    promptRef.current = null;
  };

  if (installed && !open) {
    return compact ? null : <span className="app-installed-badge"><i /> {t("install.installed")}</span>;
  }

  return (
    <>
      <button className={`worker-install-button${compact ? " compact" : ""}`} type="button" onClick={() => void install()}>
        <span>{appleDevice ? "" : "↓"}</span><b>{appleDevice ? t("install.iphoneButton") : t("install.button")}</b>
      </button>

      {open && (
        <div className="install-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="install-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="xodim-install-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="install-modal-icon xodim" aria-hidden="true">H<i>✓</i></div>
            <span className="install-kicker">{t("install.kicker")}</span>
            <h2 id="xodim-install-title">{t("install.title")}</h2>
            <p>{t("install.description")}</p>
            <ol className="install-steps">
              <li><b>1</b><span>{t("install.step1")}</span></li>
              <li><b>2</b><span>{t("install.step2")}</span></li>
              <li><b>3</b><span>{t("install.step3")}</span></li>
              <li><b>4</b><span>{t("install.step4")}</span></li>
            </ol>
            <p className="install-security-note">{t("install.security")}</p>
            <button ref={closeButton} className="install-close" type="button" onClick={() => setOpen(false)}>
              {t("install.close")}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
