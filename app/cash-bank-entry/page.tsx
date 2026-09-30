"use client";

import { PosTerminalScreen } from "../pos-terminal/page";

export default function CashBankEntryPage() {
  return <PosTerminalScreen
    publicEntry
    enableDelivery
    initialMode="sale"
    initialPaymentType="cash"
    salePaymentOptions={["cash", "bank"]}
    inventoryReasons={["Oshxonada yeyilgan ovqat", "Isrof / buzilgan"]}
    inventoryModeTitle="OSHXONADA YEYILGAN / CHIQIT"
    inventoryModeHelp="Daromadsiz, faqat ombordan minus"
    terminalSubtitle="Naqd, hisob-raqam, delivery, oshxona ovqati va chiqit"
  />;
}
