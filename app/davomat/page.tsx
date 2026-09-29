import { requireChatGPTUser } from "../chatgpt-auth";
import DavomatClient from "./davomat-client";

export default async function DavomatPage() {
  await requireChatGPTUser("/davomat");
  return <DavomatClient />;
}
