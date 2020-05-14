import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";

import * as qp from "./QuickPickProvider";
import * as DiffProvider from "../DiffProvider";

import { isTruthy } from "../TsUtils";
import { GetStatus, operationCreatesFile, Status } from "../scm/Status";
import * as ChangeQuickPick from "./ChangeQuickPick";
import { showQuickPickForFile } from "./FileQuickPick";

const nbsp = "\xa0";

export const shelvedFileQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (
        resourceOrStr: vscode.Uri | string, // string refers to a URI encoded with Uri.toString()
        operationOrStr: p4.DepotFileOperation | string, // string refers to an object serialised with JSON.stringify
        changeOrChnum: p4.ChangeInfo | string // string refers to a change number, NOT an object
    ) => {
        const resource = qp.asUri(resourceOrStr);
        const change = await getChangeDetail(resource, changeOrChnum);
        if (!change) {
            throw new Error("Could not find change details for changelist " + change);
        }
        const operation =
            typeof operationOrStr === "string"
                ? (JSON.parse(operationOrStr) as p4.DepotFileOperation)
                : operationOrStr;
        const depotUri = PerforceUri.fromDepotPath(
            resource,
            operation.depotPath,
            operation.revision
        );
        const have = await p4.have(resource, { file: depotUri });
        const actions = await makeDiffPicks(resource, depotUri, operation, have, change);
        actions.push({
            label: "$(list-flat) Go to changelist details",
            description:
                "Change " +
                change.chnum +
                nbsp +
                " $(book) " +
                nbsp +
                change.description.join(" "),
            performAction: () =>
                ChangeQuickPick.showQuickPickForChangelist(depotUri, change.chnum),
        });
        return {
            items: actions,
            placeHolder: makeShelvedFileSummary(operation.depotPath, change),
        };
    },
};

async function getChangeDetail(
    resource: vscode.Uri,
    change: p4.ChangeInfo | string
): Promise<p4.ChangeInfo | undefined> {
    if (typeof change === "string") {
        return (
            await p4.describe(resource, {
                chnums: [change],
                shelved: true,
                omitDiffs: true,
            })
        )[0];
    } else {
        return change;
    }
}

export async function showQuickPickForShelvedFile(
    resource: vscode.Uri,
    operation: p4.DepotFileOperation,
    change: p4.ChangeInfo
) {
    await qp.showQuickPick("shelvedFile", resource, operation, change);
}

function makeShelvedFileSummary(depotPath: string, changeInfo: p4.ChangeInfo) {
    return (
        "Shelved File " +
        depotPath +
        "@=" +
        changeInfo.chnum +
        " - " +
        changeInfo.description.join(" ")
    );
}

async function getMovedFromFile(
    resource: vscode.Uri,
    operation: p4.DepotFileOperation,
    change: p4.ChangeInfo
) {
    const fstat = await p4.getFstatInfo(resource, {
        depotPaths: [operation.depotPath],
        limitToShelved: true,
        outputPendingRecord: true,
        chnum: change.chnum,
    });
    if (fstat?.[0]) {
        const fromPath = fstat[0]["resolveFromFile0"];
        const endFromRev = fstat[0]["resolveEndFromRev0"];
        if (fromPath && endFromRev) {
            return PerforceUri.fromDepotPath(resource, fromPath, endFromRev);
        }
    }
}

async function makeDiffPicks(
    resource: vscode.Uri,
    uri: vscode.Uri,
    operation: p4.DepotFileOperation,
    have: p4.HaveFile | undefined,
    change: p4.ChangeInfo
): Promise<qp.ActionableQuickPickItem[]> {
    const shelvedUri = PerforceUri.fromUriWithRevision(uri, "@=" + change.chnum);
    const status = GetStatus(operation.operation);
    const movedFrom =
        status === Status.MOVE_ADD
            ? await getMovedFromFile(resource, operation, change)
            : undefined;
    return [
        {
            label: "$(file) Show shelved file",
            description: "Open the shelved file in the editor",
            performAction: () => {
                vscode.window.showTextDocument(shelvedUri);
            },
        },
        have
            ? {
                  label: "$(file) Open workspace file",
                  description: "Open the local file in the editor",
                  performAction: () => {
                      vscode.window.showTextDocument(have.localUri);
                  },
              }
            : undefined,
        !operationCreatesFile(status)
            ? {
                  label: "$(diff) Diff against source revision",
                  description: DiffProvider.diffTitleForDepotPaths(
                      operation.depotPath,
                      operation.revision,
                      operation.depotPath,
                      "@=" + change.chnum
                  ),
                  performAction: () => DiffProvider.diffFiles(uri, shelvedUri),
              }
            : undefined,
        movedFrom
            ? {
                  label: "$(diff) Diff against moved-from revision",
                  description: DiffProvider.diffTitleForDepotPaths(
                      PerforceUri.getDepotPathFromDepotUri(movedFrom),
                      PerforceUri.getRevOrAtLabel(movedFrom),
                      operation.depotPath,
                      "@=" + change.chnum
                  ),
                  performAction: () => DiffProvider.diffFiles(movedFrom, shelvedUri),
              }
            : undefined,
        // TODO e.g. move / add diff against deleted file - need fstat for that
        {
            label: "$(diff) Diff against workspace file",
            description: have ? "" : "No matching workspace file found",
            performAction: have
                ? () => {
                      DiffProvider.diffFiles(shelvedUri, have.localUri);
                  }
                : undefined,
        },
        !operationCreatesFile(status)
            ? {
                  label: "$(list-flat) Go to source revision",
                  description: PerforceUri.fsPathWithoutRev(uri),
                  performAction: () => showQuickPickForFile(uri),
              }
            : undefined,
        movedFrom
            ? {
                  label: "$(list-flat) Go to moved-from revision",
                  description:
                      PerforceUri.basenameWithoutRev(movedFrom) +
                      "#" +
                      PerforceUri.getRevOrAtLabel(movedFrom),
                  performAction: () => showQuickPickForFile(movedFrom),
              }
            : undefined,
    ].filter(isTruthy);
}
