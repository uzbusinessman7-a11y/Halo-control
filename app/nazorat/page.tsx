import OperationsClient from "./operations-client";
import { requireChatGPTUser } from "../chatgpt-auth";

export default async function OperationsPage() {
  await requireChatGPTUser("/nazorat");
  return <OperationsClient />;
}
