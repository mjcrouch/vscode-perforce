import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";

import * as qp from "./QuickPickProvider";
import { showQuickPickForFile } from "./FileQuickPick";

export const integrationQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (uri: vscode.Uri) => {
        const actions = await makeIntegrationPicks(uri);
        return {
            items: actions,
            excludeFromHistory: true,
            placeHolder:
                "Choose integration for " +
                PerforceUri.getDepotPathFromDepotUri(uri) +
                "#" +
                uri.fragment
        };
    }
};

export async function showIntegPickForFile(uri: vscode.Uri) {
    await qp.showQuickPick("integ", uri);
}

async function makeIntegrationPicks(uri: vscode.Uri) {
    const rev = parseInt(uri.fragment);

    const integs = await p4.integrated(uri, {
        file: uri,
        intoOnly: true,
        startingChnum: uri.fragment
    });

    return integs
        .filter(
            int => parseInt(int.fromStartRev) <= rev && parseInt(int.fromEndRev) >= rev
        )
        .map<qp.ActionableQuickPickItem>(int => {
            return {
                label: "$(git-merge) " + int.toFile + "#" + int.toRev,
                description:
                    int.operation + " from #" + int.fromStartRev + "," + int.fromEndRev,
                performAction: () => {
                    const thisUri = PerforceUri.fromDepotPath(
                        PerforceUri.getUsableWorkspace(uri) ?? uri,
                        int.toFile,
                        int.toRev
                    );
                    showQuickPickForFile(thisUri);
                }
            };
        });
}
