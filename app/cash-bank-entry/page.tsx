"use client";

import { PosTerminalScreen } from "../pos-terminal/page";

export default function CashBankEntryPage() {
  return <PosTerminalScreen
    publicEntry
    enableDelivery
    initialMode="sale"
    initialPaymentType="cash"
    salePaymentOptions={["cash", "bank"]}
    inventoryReasons={["Oshxonada yeyilgan ovqat"]}
    inventoryModeTitle="OSHXONADA YEYILGAN OVQAT"
    inventoryModeHelp="Daromadsiz, faqat ombordan minus"
    terminalSubtitle="Naqd, hisob-raqam, delivery va oshxona ovqati"
  />;
}
