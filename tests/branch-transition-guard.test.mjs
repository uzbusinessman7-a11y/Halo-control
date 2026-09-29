import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

const sourceBetween = (start, end) => {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return pageSource.slice(startIndex, endIndex);
};

test("branch transitions wait for the save queue and retain failed operations", () => {
  const guard = sourceBetween(
    "const guardFailedSaveBeforeBranchAction",
    "const switchBranch",
  );
  const firstFailureCheck = guard.indexOf("if (failedSaveRef.current)");
  const waitForQueue = guard.indexOf("await saveQueueRef.current");
  const secondFailureCheck = guard.indexOf("if (failedSaveRef.current)", firstFailureCheck + 1);

  assert.ok(firstFailureCheck >= 0 && firstFailureCheck < waitForQueue);
  assert.ok(waitForQueue < secondFailureCheck);
  assert.match(guard, /Avval “Qayta saqlash”ni bosing/);

  const branchSwitch = sourceBetween("const switchBranch", "const addBranch");
  assert.match(branchSwitch, /await guardFailedSaveBeforeBranchAction\("filialni almashtirish"\)/);
  assert.ok(
    branchSwitch.indexOf("guardFailedSaveBeforeBranchAction")
      < branchSwitch.indexOf("confirmBranchDraftLoss"),
    "the failed operation must block before any draft-discard prompt",
  );
  assert.doesNotMatch(branchSwitch, /failedSaveRef\.current\s*=\s*null/);
});

test("branch creation and archive paths block before opening prompts or mutating branches", () => {
  const addBranch = sourceBetween("const addBranch", "const renameBranch");
  assert.match(addBranch, /await guardFailedSaveBeforeBranchAction\("yangi filial yaratish"\)/);
  assert.ok(
    addBranch.indexOf("guardFailedSaveBeforeBranchAction") < addBranch.indexOf("window.prompt"),
    "branch creation must not prompt while an unsaved failed operation exists",
  );

  const deleteBranch = sourceBetween("const deleteBranch", "const withDeletedItem");
  const guardIndex = deleteBranch.indexOf("guardFailedSaveBeforeBranchAction");
  assert.match(deleteBranch, /await guardFailedSaveBeforeBranchAction\("filialni o‘chirish"\)/);
  assert.ok(guardIndex < deleteBranch.indexOf("window.confirm"));
  assert.ok(guardIndex < deleteBranch.indexOf("askCancellationReason"));
  assert.ok(guardIndex < deleteBranch.indexOf('method: "DELETE"'));
});
