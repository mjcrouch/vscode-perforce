import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";

import * as qp from "./QuickPickProvider";
import * as DiffProvider from "../DiffProvider";
import { Display } from "../Display";
import { DescribedChangelist, shelve } from "../api/PerforceApi";
import { showQuickPickForFile } from "./FileQuickPick";
import { toReadableDateTime } from "../DateFormatter";
import { configAccessor } from "../ConfigService";
import { focusChangelist } from "../search/ChangelistTreeView";
import { PerforceSCMProvider } from "../ScmProvider";
import { pluralise, isTruthy } from "../TsUtils";
import { GetStatus, operationCreatesFile } from "../scm/Status";
import * as ChangeQuickPick from "./ChangeQuickPick";

const nbsp = "\xa0";

export const shelvedFileQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (
        resource: vscode.Uri,
        operation: p4.DepotFileOperation,
        change: p4.ChangeInfo
    ) => {
        const depotUri = PerforceUri.fromDepotPath(
            resource,
            operation.depotPath,
            operation.revision
        );
        const have = await p4.have(resource, { file: depotUri });
        const actions = makeDiffPicks(resource, depotUri, operation, have, change);
        actions.push({
            label: "$(list-flat) Go to changelist details",
            description:
                "Change " + change.chnum + nbsp + " $(book) " + nbsp + change.description,
            performAction: () =>
                ChangeQuickPick.showQuickPickForChangelist(depotUri, change.chnum),
        });
        return {
            items: actions,
            placeHolder: makeShelvedFileSummary(operation.depotPath, change),
        };
    },
};

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

function makeDiffPicks(
    resource: vscode.Uri,
    uri: vscode.Uri,
    operation: p4.DepotFileOperation,
    have: p4.HaveFile | undefined,
    change: p4.ChangeInfo
): qp.ActionableQuickPickItem[] {
    const shelvedUri = PerforceUri.fromUriWithRevision(uri, "@=" + change.chnum);
    const status = GetStatus(operation.operation);
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
        {
            label: "$(diff) Diff against workspace file",
            description: have ? "" : "No matching workspace file found",
            performAction: have
                ? () => {
                      DiffProvider.diffFiles(shelvedUri, have.localUri);
                  }
                : undefined,
        },
        /*{
            label: "$(diff) Diff against...",
            description: "Choose another revision to diff against",
            performAction: () => {
                showDiffChooserForFile(uri);
            },
        },*/
    ].filter(isTruthy);
}
